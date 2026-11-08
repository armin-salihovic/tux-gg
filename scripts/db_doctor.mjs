#!/usr/bin/env node

import {
	categorizeConnectionError,
	createDatabaseClient,
	dockerPortSummary,
	resolveDatabaseUrl
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
	console.log('Windows checks: docker ps --format "table {{.Names}}\\t{{.Ports}}"');
	console.log(`  Test-NetConnection 127.0.0.1 -Port ${port}`);
	console.log(
		'For a Windows-host app, DB_HOST must be 127.0.0.1 and DB_PORT must be the Docker published host port.'
	);
}

async function main() {
	let connection;
	try {
		connection = resolveDatabaseUrl('doctor');
	} catch (error) {
		console.error(error.message);
		printDockerPorts();
		printWindowsChecks();
		return 1;
	}
	const summary = connection.summary;
	console.log('Mode: read-only');
	console.log(
		`DB_* target: host=${summary.host} port=${summary.port} database=${summary.database} username=${summary.username}`
	);
	if (summary.database !== 'vapourdb' && !connection.testIdentity) {
		console.error(
			'DB_DATABASE must be exactly vapourdb; no connection was opened to the selected database.'
		);
		printDockerPorts();
		printWindowsChecks(summary.port);
		return 1;
	}
	const client = createDatabaseClient(connection, 'vapourdb-db-doctor');
	try {
		await client.connect();
		const result = await client.query(
			`SELECT current_database() AS database, current_user AS username,
			        current_setting('server_version') AS server_version,
			        inet_server_addr()::text AS server_address,
			        has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_database_objects,
			        has_schema_privilege(current_user, 'public', 'USAGE') AS can_use_public,
			        has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_public,
			        to_regnamespace('drizzle') IS NOT NULL AS has_drizzle_schema,
			        CASE WHEN to_regnamespace('drizzle') IS NULL
			             THEN has_database_privilege(current_user, current_database(), 'CREATE')
			             ELSE has_schema_privilege(current_user, 'drizzle', 'USAGE')
			                  AND has_schema_privilege(current_user, 'drizzle', 'CREATE') END AS can_create_migration_history,
			        CASE WHEN to_regclass('public.games') IS NULL THEN false ELSE has_table_privilege(current_user, 'public.games', 'SELECT') END AS can_read_games,
			        CASE WHEN to_regclass('public.games') IS NULL THEN false ELSE has_table_privilege(current_user, 'public.games', 'INSERT') END AS can_insert_games,
			        CASE WHEN to_regclass('public.games') IS NULL THEN false ELSE has_table_privilege(current_user, 'public.games', 'UPDATE') END AS can_update_games,
			        to_regclass('public.games') IS NOT NULL AS has_games,
			        to_regclass('public.user') IS NOT NULL AS has_user,
			        to_regclass('public.account') IS NOT NULL AS has_account,
			        to_regclass('public.session') IS NOT NULL AS has_session,
			        to_regclass('public.verification') IS NOT NULL AS has_verification,
			        to_regclass('public.native_reports') IS NOT NULL AS has_native_reports,
			        to_regclass('public.user_devices') IS NOT NULL AS has_user_devices,
			        to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS has_migration_history`
		);
		const row = result.rows[0];
		console.log(
			`Connected: database=${row.database} username=${row.username} PostgreSQL=${row.server_version} server_address=${row.server_address ?? 'unknown'}`
		);
		console.log(
			`Privileges: database_create=${row.can_create_database_objects} public_usage=${row.can_use_public} public_create=${row.can_create_public} drizzle_usage_create=${row.can_create_migration_history} games_select=${row.can_read_games} games_insert=${row.can_insert_games} games_update=${row.can_update_games}`
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
		printDockerPorts();
		printWindowsChecks(summary.port);
		return 0;
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
