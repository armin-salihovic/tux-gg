#!/usr/bin/env node

import {
	categorizeConnectionError,
	createDatabaseClient,
	databaseMode,
	dockerPortSummary,
	safeUrlSummary
} from './database-connection.mjs';
import { loadLocalEnv } from './games-catalog.mjs';

loadLocalEnv();

function printDockerPorts() {
	if (process.env.VAPOURDB_DOCTOR_SKIP_DOCKER === '1') {
		console.log('Docker port details: skipped by the diagnostic test.');
		return;
	}
	const result = dockerPortSummary();
	if (!result.available) {
		console.log('Docker port details: unavailable (Docker CLI or daemon not available).');
		return;
	}
	console.log('Docker published ports:');
	if (result.lines.length) for (const line of result.lines) console.log(`  ${line}`);
	else console.log('  No running containers.');
}

function printWindowsChecks(port = '5432') {
	console.log('Windows checks: docker ps --format "table {{.Names}}\t{{.Ports}}"');
	console.log(`  Test-NetConnection 127.0.0.1 -Port ${port}`);
	console.log(
		'  A Windows-host app must use the Docker published host port; container service names only work from a container network.'
	);
}

async function main() {
	const raw = process.env.DATABASE_URL;
	const mode = databaseMode();
	console.log(`Mode: ${mode}`);
	if (!raw) {
		console.error('DATABASE_URL is not configured.');
		printDockerPorts();
		printWindowsChecks();
		return 1;
	}
	let summary;
	try {
		summary = safeUrlSummary(raw);
	} catch {
		console.error('DATABASE_URL is not a valid PostgreSQL connection URL.');
		return 1;
	}
	console.log(
		`DATABASE_URL target: host=${summary.host} port=${summary.port} database=${summary.database} username=${summary.username}`
	);
	if (mode === 'development' && summary.username === 'vapourdb_web')
		console.log(
			'Configuration note: vapourdb_web is a restricted production role; local migrations require vapourdb_dev.'
		);
	if (
		mode === 'development' &&
		!['localhost', '127.0.0.1', '::1'].includes(summary.host.toLowerCase())
	)
		console.log('Configuration note: local write commands require a loopback host URL.');
	const client = createDatabaseClient(raw, 'vapourdb-db-doctor');
	try {
		await client.connect();
		const result = await client.query(
			`SELECT current_database() AS database, current_user AS username,
			        current_setting('server_version') AS server_version,
			        inet_server_addr()::text AS server_address,
			        has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_schema,
			        r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls,
			        d.datdba = r.oid AS owns_database,
			        EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = r.oid) AS has_role_membership,
		        CASE WHEN to_regclass('public.games') IS NULL THEN false ELSE has_table_privilege(current_user, to_regclass('public.games'), 'INSERT') END AS can_insert_games,
		        CASE WHEN to_regclass('public.games') IS NULL THEN false ELSE has_table_privilege(current_user, to_regclass('public.games'), 'UPDATE') END AS can_update_games,
			        to_regclass('public.games') IS NOT NULL AS has_games,
			        to_regclass('public.user') IS NOT NULL AS has_user,
			        to_regclass('public.account') IS NOT NULL AS has_account,
			        to_regclass('public.session') IS NOT NULL AS has_session,
			        to_regclass('public.verification') IS NOT NULL AS has_verification,
			        to_regclass('public.native_reports') IS NOT NULL AS has_native_reports,
			        to_regclass('public.user_devices') IS NOT NULL AS has_user_devices,
			        to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS has_migration_history
			 FROM pg_roles r CROSS JOIN pg_database d
			 WHERE r.rolname = current_user AND d.datname = current_database()`
		);
		const row = result.rows[0];
		console.log(
			`Connected: database=${row.database} username=${row.username} PostgreSQL=${row.server_version} server_address=${row.server_address ?? 'unknown'}`
		);
		console.log(
			`Privileges: schema_create=${row.can_create_schema} games_insert=${row.can_insert_games} games_update=${row.can_update_games}`
		);
		console.log('Tables:');
		for (const [label, key] of [
			['games', 'has_games'],
			['user', 'has_user'],
			['account', 'has_account'],
			['session', 'has_session'],
			['verification', 'has_verification'],
			['native_reports', 'has_native_reports'],
			['user_devices', 'has_user_devices'],
			['Drizzle migration history', 'has_migration_history']
		])
			console.log(`  ${label}: ${row[key] ? 'present' : 'missing'}`);
		let localTargetOk = true;
		if (mode === 'development') {
			if (!['localhost', '127.0.0.1', '::1'].includes(summary.host.toLowerCase())) {
				console.error(
					'Local development writes are restricted to a loopback host; this URL points elsewhere.'
				);
				localTargetOk = false;
			}
			if (row.database !== 'vapourdb') {
				console.error(
					'Local write commands only select the vapourdb database; legacy and test databases are not migrated implicitly.'
				);
				localTargetOk = false;
			}
			if (row.username === 'vapourdb_web') {
				console.error(
					'vapourdb_web is a restricted production role. Keep it restricted and use a dedicated vapourdb_dev owner for local migrations.'
				);
				localTargetOk = false;
			} else if (row.username !== 'vapourdb_dev') {
				console.error('Local DATABASE_URL must use the dedicated vapourdb_dev role.');
				localTargetOk = false;
			}
			if (
				row.rolsuper ||
				row.rolcreatedb ||
				row.rolcreaterole ||
				row.rolreplication ||
				row.rolbypassrls ||
				row.has_role_membership
			) {
				console.error(
					'The local role has administrator attributes or memberships; use a restricted dedicated development role.'
				);
				localTargetOk = false;
			}
			if (row.username === 'vapourdb_dev' && (!row.owns_database || !row.can_create_schema)) {
				console.error('vapourdb_dev must own vapourdb and be able to create objects in public.');
				localTargetOk = false;
			}
		}
		printDockerPorts();
		printWindowsChecks(summary.port);
		return localTargetOk ? 0 : 1;
	} catch (error) {
		console.error(`${categorizeConnectionError(error)}.`);
		printDockerPorts();
		printWindowsChecks(summary.port);
		return 1;
	} finally {
		await client.end().catch(() => {});
	}
}

process.exitCode = await main();
