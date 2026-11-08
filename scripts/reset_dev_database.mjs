#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { identityForDatabase, isLocalHostname } from './database-identifiers.mjs';
import { loadLocalEnv } from './games-catalog.mjs';
import { verifyGamesBackup } from './verify_games_backup.mjs';
import { parseInitializationArgs, requireDatabaseRoleUrl } from './database-safety.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadLocalEnv();

function localPostgresUrl(raw, name, expectedDatabase, expectedRole) {
	if (!raw) throw new Error(`${name} is not configured.`);
	let url;
	try {
		url = new URL(raw);
	} catch {
		throw new Error(`${name} is not a valid PostgreSQL URL.`);
	}
	const database = decodeURIComponent(url.pathname.slice(1));
	const user = decodeURIComponent(url.username);
	if (!/^postgres(?:ql)?:$/.test(url.protocol)) throw new Error(`${name} must use PostgreSQL.`);
	if (!isLocalHostname(url.hostname))
		throw new Error(`${name} must connect to the local development server.`);
	if (database !== expectedDatabase || user !== expectedRole)
		throw new Error(`${name} must target ${expectedDatabase} using ${expectedRole}.`);
	return url;
}

function run(command, args) {
	const onWindowsPnpm = process.platform === 'win32' && command === 'pnpm.cmd';
	const executable = onWindowsPnpm ? process.env.ComSpec || 'cmd.exe' : command;
	const executableArgs = onWindowsPnpm ? ['/d', '/c', [command, ...args].join(' ')] : args;
	const result = spawnSync(executable, executableArgs, {
		cwd: ROOT,
		encoding: 'utf8',
		windowsHide: true,
		env: process.env
	});
	if (result.status !== 0) {
		let output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
		for (const key of [
			'DATABASE_URL',
			'IMPORTER_DATABASE_URL',
			'MIGRATION_DATABASE_URL',
			'PGADMIN_URL'
		]) {
			const secretUrl = process.env[key];
			if (secretUrl) output = output.replaceAll(secretUrl, '<redacted PostgreSQL URL>');
		}
		output = output.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, '<redacted PostgreSQL URL>');
		throw new Error(
			`${path.basename(command)} ${args.join(' ')} failed. ${output.slice(-3000).trim()}`
		);
	}
}

async function main() {
	const options = parseInitializationArgs(process.argv.slice(2));
	if ((process.env.NODE_ENV || 'development') === 'production')
		throw new Error('Refusing development initialization when NODE_ENV is production.');
	const migrationRaw = process.env.MIGRATION_DATABASE_URL;
	const migrationParsed = migrationRaw ? new URL(migrationRaw) : null;
	const database = migrationParsed ? decodeURIComponent(migrationParsed.pathname.slice(1)) : '';
	const identity = identityForDatabase(database);
	if (!identity || identity.application !== database)
		throw new Error('MIGRATION_DATABASE_URL must target the local VapourDB application database.');
	requireDatabaseRoleUrl(migrationRaw, 'MIGRATION_DATABASE_URL', identity.roles.migrator);
	const migrationUrl = localPostgresUrl(
		migrationRaw,
		'MIGRATION_DATABASE_URL',
		database,
		identity.roles.migrator
	);
	const adminUrl = localPostgresUrl(process.env.PGADMIN_URL, 'PGADMIN_URL', 'postgres', 'postgres');
	const backup = options.games ? await verifyGamesBackup(options.games) : null;
	if (backup && backup.manifest.database !== database)
		throw new Error('The verified games backup must identify the same application database.');
	if (backup)
		console.log(
			`Verified external games backup: ${backup.games.length} rows; CSV and archive checksums match.`
		);

	const migration = new pg.Client({
		connectionString: migrationUrl.toString(),
		application_name: 'vapourdb-empty-initialization'
	});
	const adminTargetUrl = new URL(adminUrl.toString());
	adminTargetUrl.pathname = `/${database}`;
	const admin = new pg.Client({
		connectionString: adminTargetUrl.toString(),
		application_name: 'vapourdb-empty-initialization-admin'
	});
	try {
		await migration.connect();
		await migration.query('BEGIN READ ONLY');
		const identityResult = await migration.query(
			`SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS address,
			        current_setting('server_version') AS version, pg_get_userbyid(nspowner) AS schema_owner
			 FROM pg_namespace WHERE nspname = 'public'`
		);
		const sourceIdentity = identityResult.rows[0];
		assert.equal(sourceIdentity?.database, database);
		assert.equal(sourceIdentity?.role, identity.roles.migrator);
		assert.equal(sourceIdentity?.schema_owner, identity.roles.migrator);
		if (
			!sourceIdentity?.address ||
			(!sourceIdentity.address.startsWith('127.') && sourceIdentity.address !== '::1')
		)
			throw new Error('PostgreSQL did not identify a loopback TCP server address.');
		const objectCounts = await migration.query(
			`SELECT
			  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
			   WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
			     AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')) AS relations,
			  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
			   WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema') AS routines,
			  (SELECT count(*) FROM pg_namespace
			   WHERE nspname NOT LIKE 'pg_%' AND nspname NOT IN ('information_schema', 'public')) AS extra_schemas`
		);
		assert.deepEqual(objectCounts.rows[0], { relations: '0', routines: '0', extra_schemas: '0' });

		await admin.connect();
		await admin.query('BEGIN READ ONLY');
		const adminIdentity = await admin.query(
			`SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS address,
			        pg_get_userbyid(datdba) AS owner
			 FROM pg_database JOIN pg_namespace ON nspname = 'public'
			 WHERE datname = current_database()`
		);
		assert.equal(adminIdentity.rows[0]?.database, database);
		assert.equal(adminIdentity.rows[0]?.role, 'postgres');
		assert.equal(adminIdentity.rows[0]?.address, sourceIdentity.address);
		if ([identity.roles.web, identity.roles.importer].includes(adminIdentity.rows[0]?.owner))
			throw new Error('A runtime role owns the application database.');
		await Promise.all([migration.query('ROLLBACK'), admin.query('ROLLBACK')]);
		await admin.end();

		const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
		run(pnpm, ['db:migrate']);
		console.log('Applied the baseline to the verified empty local schema.');
		run(pnpm, ['db:grant']);
		console.log('Applied the reviewed web, importer, and migration role grants.');
		if (backup) run(process.execPath, ['scripts/restore_games.mjs', backup.csvPath]);

		const tables = await migration.query(
			"SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
		);
		assert.deepEqual(
			tables.rows.map((row) => row.tablename),
			['account', 'games', 'native_reports', 'session', 'user', 'user_devices', 'verification']
		);
		const games = await migration.query(
			`SELECT app_id, title, slug, artwork_url, header_image_url, metadata, created_at, updated_at
			 FROM public.games ORDER BY app_id`
		);
		const expectedGames = backup?.games ?? [];
		assert.deepEqual(
			games.rows.map((row) => row.app_id),
			expectedGames.map((row) => row.app_id).sort()
		);
		for (const expected of expectedGames) {
			const actual = games.rows.find((row) => row.app_id === expected.app_id);
			assert.ok(actual, `Restored AppID ${expected.app_id} is present.`);
			assert.equal(actual.title, expected.title);
			assert.equal(actual.slug, expected.slug);
			assert.equal(actual.artwork_url, expected.artwork_url);
			assert.equal(actual.header_image_url, expected.header_image_url);
			assert.deepEqual(actual.metadata, JSON.parse(expected.metadata));
			assert.equal(actual.created_at.toISOString(), new Date(expected.created_at).toISOString());
			assert.equal(actual.updated_at.toISOString(), new Date(expected.updated_at).toISOString());
		}
		const counts = await migration.query(
			`SELECT (SELECT count(*)::int FROM public.user) AS users,
			        (SELECT count(*)::int FROM public.account) AS accounts,
			        (SELECT count(*)::int FROM public.session) AS sessions,
			        (SELECT count(*)::int FROM public.user_devices) AS devices,
			        (SELECT count(*)::int FROM public.native_reports) AS reports`
		);
		assert.deepEqual(counts.rows[0], {
			users: 0,
			accounts: 0,
			sessions: 0,
			devices: 0,
			reports: 0
		});
		const privileges = await migration.query(
			`SELECT has_table_privilege($1, 'public.games', 'SELECT') AS web_read,
			        has_table_privilege($2, 'public.games', 'INSERT') AS importer_insert,
			        has_table_privilege($1, 'public.native_reports', 'UPDATE') AS web_cannot_moderate,
			        has_table_privilege($2, 'public.user', 'SELECT') AS importer_cannot_read_accounts`,
			[identity.roles.web, identity.roles.importer]
		);
		assert.deepEqual(privileges.rows[0], {
			web_read: true,
			importer_insert: true,
			web_cannot_moderate: false,
			importer_cannot_read_accounts: false
		});
		console.log(
			`Verified ${games.rows.length} games, ${games.rows.length} distinct AppIDs, empty user/report tables, and least-privilege grants.`
		);
	} finally {
		await Promise.all([migration.end().catch(() => {}), admin.end().catch(() => {})]);
	}
}

main().catch((error) => {
	console.error(
		`Development database initialization refused or failed: ${error instanceof Error ? error.message : 'unknown error'}`
	);
	process.exitCode = 1;
});
