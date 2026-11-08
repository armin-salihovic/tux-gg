#!/usr/bin/env node

import path from 'node:path';
import pg from 'pg';
import { identityForDatabase, testIdentityForDatabase } from './database-identifiers.mjs';
import {
	GAME_COLUMNS,
	loadLocalEnv,
	MERGE_METADATA_FUNCTION,
	parseGamesCsv
} from './games-catalog.mjs';

loadLocalEnv();
const csvPath = process.argv[2];
if (!csvPath || process.argv.length > 3) {
	console.error('Usage: pnpm db:restore:games -- <games.csv>');
	process.exit(2);
}

const connectionString = process.env.IMPORTER_DATABASE_URL;
if (!connectionString) {
	console.error('IMPORTER_DATABASE_URL is not configured.');
	process.exit(1);
}

let client;
try {
	const games = parseGamesCsv(path.resolve(csvPath));
	client = new pg.Client({ connectionString, application_name: 'vapourdb-games-restore' });
	await client.connect();
	const identity = await client.query(
		`SELECT current_database() AS database, current_user AS role,
		        has_table_privilege(current_user, 'public.games', 'INSERT') AS can_insert,
		        has_table_privilege(current_user, 'public.games', 'UPDATE') AS can_update`
	);
	const databaseName = identity.rows[0]?.database;
	const appIdentity = identityForDatabase(databaseName);
	const testIdentity = testIdentityForDatabase(databaseName);
	const restoreVerifyPrefix = databaseName?.match(
		/^(vapourdb|tuxgg)_restore_verify_[a-f0-9]{12}$/
	)?.[1];
	const restoreVerifyIdentity = restoreVerifyPrefix
		? identityForDatabase(restoreVerifyPrefix)
		: null;
	if (!appIdentity && !testIdentity && !restoreVerifyIdentity)
		throw new Error('Refusing to import games into an unrecognized database.');
	const expectedIdentity = appIdentity ?? testIdentity ?? restoreVerifyIdentity;
	if (identity.rows[0]?.role !== expectedIdentity.roles.importer)
		throw new Error('IMPORTER_DATABASE_URL must use the matching catalog-writer role.');
	if (testIdentity) {
		const marker = await client
			.query(`SELECT marker FROM public.${testIdentity.markerTable} WHERE id = 1`)
			.catch(() => ({ rows: [] }));
		if (marker.rows[0]?.marker !== testIdentity.markerValue)
			throw new Error('Refusing to import into an unmarked disposable test database.');
	}
	if (restoreVerifyIdentity) {
		const marker = await client
			.query(`SELECT marker FROM public.${restoreVerifyPrefix}_restore_verify_marker WHERE id = 1`)
			.catch(() => ({ rows: [] }));
		if (marker.rows[0]?.marker !== `${restoreVerifyPrefix}_games_csv_restore_verification_v1`)
			throw new Error('Refusing to import into an unmarked CSV restore verification database.');
	}
	if (!identity.rows[0].can_insert || !identity.rows[0].can_update)
		throw new Error('The configured database role needs INSERT and UPDATE access to public.games.');
	await client.query('BEGIN');
	await client.query(MERGE_METADATA_FUNCTION);
	let imported = 0;
	const batchSize = 250;
	for (let offset = 0; offset < games.length; offset += batchSize) {
		const batch = games.slice(offset, offset + batchSize);
		const values = [];
		const tuples = batch.map((game) => {
			const first = values.length + 1;
			values.push(...GAME_COLUMNS.map((column) => game[column]));
			return `($${first}::text, $${first + 1}::text, $${first + 2}::text, $${first + 3}::text, $${first + 4}::text, $${first + 5}::jsonb, $${first + 6}::timestamptz, $${first + 7}::timestamptz)`;
		});
		await client.query(
			`INSERT INTO public.games (app_id, title, slug, artwork_url, header_image_url, metadata, created_at, updated_at)
			 VALUES ${tuples.join(',')}
			 ON CONFLICT (app_id) DO UPDATE SET
			   title = COALESCE(NULLIF(EXCLUDED.title, ''), public.games.title),
			   slug = COALESCE(NULLIF(EXCLUDED.slug, ''), public.games.slug),
			   artwork_url = COALESCE(NULLIF(EXCLUDED.artwork_url, ''), public.games.artwork_url),
			   header_image_url = COALESCE(NULLIF(EXCLUDED.header_image_url, ''), public.games.header_image_url),
			   metadata = pg_temp.vapourdb_merge_metadata(public.games.metadata, EXCLUDED.metadata),
			   created_at = LEAST(public.games.created_at, EXCLUDED.created_at),
			   updated_at = GREATEST(public.games.updated_at, EXCLUDED.updated_at)`,
			values
		);
		imported += batch.length;
	}
	const expectedIds = games.map((game) => game.app_id);
	const verified = await client.query(
		`SELECT count(*)::int AS rows, count(DISTINCT app_id)::int AS unique_app_ids
		 FROM public.games WHERE app_id = ANY($1::text[])`,
		[expectedIds]
	);
	if (verified.rows[0]?.rows !== games.length || verified.rows[0]?.unique_app_ids !== games.length)
		throw new Error('Post-import verification found missing or duplicate AppIDs.');
	await client.query('COMMIT');
	console.log(
		`Imported and verified ${imported.toLocaleString()} game rows from ${path.resolve(csvPath)} into ${databaseName}.`
	);
	console.log('Existing usable fields and unknown metadata keys were preserved on AppID upserts.');
} catch (error) {
	if (client) await client.query('ROLLBACK').catch(() => {});
	console.error(`Games restore failed: ${error.message}`);
	process.exitCode = 1;
} finally {
	if (client) await client.end().catch(() => {});
}
