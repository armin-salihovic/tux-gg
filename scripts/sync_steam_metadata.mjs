#!/usr/bin/env node

import { loadLocalEnv, MERGE_METADATA_FUNCTION, slugify } from './games-catalog.mjs';
import { identityForDatabase, testIdentityForDatabase } from './database-identifiers.mjs';
import {
	createDatabaseClient,
	normalizePnpmArgs,
	preflightDatabase,
	resolveDatabaseUrl
} from './database-connection.mjs';
import {
	fetchSteamDetails,
	planSteamMetadataSync,
	STEAM_METADATA_TTL_MS,
	waitForSteamRequestSlot
} from '../src/lib/server/steam-metadata.ts';

loadLocalEnv();

function parseArgs(args) {
	const result = { ids: [], limit: 10, dryRun: false, force: false };
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === '--dry-run') result.dryRun = true;
		else if (arg === '--force') result.force = true;
		else if (arg === '--ids') {
			const value = args[++index];
			if (!value) throw new Error('--ids requires a comma-separated list of Steam AppIDs.');
			result.ids = value
				.split(/[\s,]+/)
				.map((id) => id.trim())
				.filter(Boolean);
		} else if (arg === '--limit') {
			const value = Number(args[++index]);
			if (!Number.isInteger(value) || value < 1 || value > 20)
				throw new Error('--limit must be between 1 and 20.');
			result.limit = value;
		} else throw new Error(`Unknown option: ${arg}`);
	}
	if (result.ids.length > 20 || result.ids.some((id) => !/^\d+$/.test(id)))
		throw new Error('--ids must contain up to 20 numeric AppIDs.');
	if (new Set(result.ids).size !== result.ids.length)
		throw new Error('--ids contains duplicate AppIDs.');
	if (result.ids.length && result.ids.length > result.limit)
		throw new Error('--ids cannot contain more games than --limit.');
	return result;
}

function nonEmpty(value) {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeSteamDetails(data) {
	const details = {
		raw: data,
		name: nonEmpty(data.name),
		type: nonEmpty(data.type),
		shortDescription: nonEmpty(data.short_description),
		detailedDescription: nonEmpty(data.detailed_description),
		developers: Array.isArray(data.developers)
			? data.developers.filter((item) => typeof item === 'string' && item.trim())
			: [],
		publishers: Array.isArray(data.publishers)
			? data.publishers.filter((item) => typeof item === 'string' && item.trim())
			: [],
		releaseDate: nonEmpty(data.release_date?.date),
		genres: Array.isArray(data.genres)
			? data.genres.map(({ description }) => description).filter(Boolean)
			: [],
		categories: Array.isArray(data.categories)
			? data.categories.map(({ description }) => description).filter(Boolean)
			: [],
		platforms: data.platforms && typeof data.platforms === 'object' ? data.platforms : {},
		isFree: typeof data.is_free === 'boolean' ? data.is_free : null,
		capsuleImage: nonEmpty(data.capsule_image),
		headerImage: nonEmpty(data.header_image),
		website: nonEmpty(data.website),
		lastFetchedAt: new Date().toISOString()
	};
	return Object.fromEntries(
		Object.entries(details).filter(([, value]) => {
			if (value === null) return false;
			if (Array.isArray(value) && value.length === 0) return false;
			if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)
				return false;
			return true;
		})
	);
}

async function main() {
	let client;
	try {
		const options = parseArgs(normalizePnpmArgs(process.argv.slice(2)));
		const databaseConnection = resolveDatabaseUrl(options.dryRun ? 'steamRead' : 'steamWrite');
		await preflightDatabase(databaseConnection, {
			operation: options.dryRun ? 'steamRead' : 'steamWrite',
			requireLocalOwner: false
		});
		client = createDatabaseClient(databaseConnection.raw, 'vapourdb-steam-metadata-sync');
		await client.connect();
		const connection = await client.query(
			'SELECT current_database() AS database, current_user AS role'
		);
		const databaseName = connection.rows[0]?.database;
		const databaseIdentity = identityForDatabase(databaseName);
		const testIdentity = testIdentityForDatabase(databaseName);
		const expectedRole =
			databaseConnection.mode === 'development'
				? databaseConnection.expectedRole
				: options.dryRun
					? databaseIdentity?.roles.web
					: databaseIdentity?.roles.importer;
		if (!databaseIdentity || connection.rows[0]?.role !== expectedRole)
			throw new Error('Refusing to sync against an unrecognized database.');
		if (testIdentity) {
			const marker = await client
				.query(`SELECT marker FROM public.${testIdentity.markerTable} WHERE id = 1`)
				.catch(() => ({ rows: [] }));
			if (marker.rows[0]?.marker !== testIdentity.markerValue)
				throw new Error('Refusing to sync a test database without its disposable safety marker.');
		}
		let games;
		const now = Date.now();
		const cutoff = new Date(now - STEAM_METADATA_TTL_MS).toISOString();
		if (options.ids.length) {
			const selected = await client.query(
				'SELECT app_id, title, metadata FROM public.games WHERE app_id = ANY($1::text[])',
				[options.ids]
			);
			const byId = new Map(selected.rows.map((row) => [row.app_id, row]));
			games = options.ids.map((appId) => byId.get(appId)).filter(Boolean);
		} else {
			const freshAt = "metadata #>> '{steam,lastFetchedAt}'";
			const staleFilter = options.force
				? ''
				: `WHERE ${freshAt} IS NULL
				OR ${freshAt} !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}.*Z$'
				OR ${freshAt} < $2`;
			const selected = await client.query(
				`SELECT app_id, title, metadata FROM public.games ${staleFilter}
			 ORDER BY CASE WHEN title IS NULL OR artwork_url IS NULL OR metadata = '{}'::jsonb THEN 0 ELSE 1 END,
			          updated_at ASC, app_id ASC LIMIT $1`,
				options.force ? [options.limit] : [options.limit, cutoff]
			);
			games = selected.rows;
		}
		if (games.length === 0) {
			console.log(
				options.ids.length
					? 'None of the requested AppIDs are present in public.games.'
					: 'No stale games need a metadata refresh.'
			);
			return;
		}
		const planned = planSteamMetadataSync(games, { force: options.force, now });

		console.log(
			`${options.dryRun ? 'Previewing' : 'Refreshing'} ${planned.fetch.length} of ${games.length} existing Steam app(s); ${planned.cached.length} fresh entries skipped${options.force ? ' (forced refresh)' : ''}.`
		);
		if (options.dryRun) {
			for (const game of planned.fetch) console.log(`${game.app_id}: would fetch`);
			for (const game of planned.cached) console.log(`${game.app_id}: skipped (fresh cache)`);
			console.log(
				'Dry run complete; no Steam requests were made and the database was not modified.'
			);
			return;
		}
		await client.query(MERGE_METADATA_FUNCTION);
		const results = [];
		let lastRequestAt = null;
		for (const game of planned.fetch) {
			lastRequestAt = await waitForSteamRequestSlot(lastRequestAt);
			const result = await fetchSteamDetails(game.app_id);
			if (result.status === 'ok') {
				const name = nonEmpty(result.data.name);
				const steamMetadata = normalizeSteamDetails(result.data);
				await client.query(
					`INSERT INTO public.games (app_id, title, slug, artwork_url, header_image_url, metadata)
					 VALUES ($1, $2, $3, $4, $5, $6::jsonb)
					 ON CONFLICT (app_id) DO UPDATE SET
					   title = COALESCE(NULLIF(EXCLUDED.title, ''), public.games.title),
					   slug = COALESCE(NULLIF(public.games.slug, ''), EXCLUDED.slug),
					   artwork_url = COALESCE(NULLIF(EXCLUDED.artwork_url, ''), public.games.artwork_url),
					   header_image_url = COALESCE(NULLIF(EXCLUDED.header_image_url, ''), public.games.header_image_url),
					   metadata = pg_temp.vapourdb_merge_metadata(public.games.metadata, EXCLUDED.metadata),
					   updated_at = now()`,
					[
						game.app_id,
						name,
						slugify(name, game.app_id),
						nonEmpty(result.data.capsule_image),
						nonEmpty(result.data.header_image),
						JSON.stringify({ steam: steamMetadata })
					]
				);
				results.push({
					appId: game.app_id,
					title: name,
					status: 'updated'
				});
			} else
				results.push({
					appId: game.app_id,
					title: null,
					status: `Steam details unavailable${result.code ? ` (HTTP ${result.code})` : ''}`
				});
			console.log(
				`${game.app_id}: ${result.status === 'ok' ? (nonEmpty(result.data.name) ?? 'name unavailable') : `unavailable${result.code ? ` (HTTP ${result.code})` : ''}`}`
			);
		}
		console.log(
			`Finished: ${results.filter((result) => result.status === 'updated').length} updated, ${results.filter((result) => result.status.startsWith('Steam details unavailable')).length} unavailable.`
		);
	} catch (error) {
		const detail =
			error instanceof Error
				? `${error.name}${error.message ? `: ${error.message}` : ''}`
				: String(error);
		console.error(`Steam metadata sync failed: ${detail}`);
		process.exitCode = 1;
	} finally {
		if (client) await client.end().catch(() => {});
	}
}

await main();
