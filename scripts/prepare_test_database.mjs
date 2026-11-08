#!/usr/bin/env node

import pg from 'pg';
import { resolveDatabaseUrl } from './database-connection.mjs';
import { testIdentityForDatabase } from './database-identifiers.mjs';

async function main() {
	if (process.env.GITHUB_ACTIONS !== 'true' || process.env.VAPOURDB_TEST_DATABASE !== '1') {
		console.error('Test database preparation is restricted to the marked GitHub Actions service.');
		return 1;
	}
	let connection;
	try {
		connection = resolveDatabaseUrl('doctor');
	} catch (error) {
		console.error(error.message);
		return 1;
	}
	const identity = testIdentityForDatabase(connection.summary.database);
	if (!identity || connection.summary.database !== 'vapourdb_test') {
		console.error('Test database preparation accepts only vapourdb_test.');
		return 1;
	}
	let maintenance;
	try {
		maintenance = new pg.Client({ ...connection.options, database: 'postgres' });
		await maintenance.connect();
		const connected = await maintenance.query('SELECT current_database() AS database');
		if (connected.rows[0]?.database !== 'postgres')
			throw new Error('Maintenance connection identity was not postgres.');
		const exists = await maintenance.query('SELECT 1 FROM pg_database WHERE datname = $1', [
			connection.summary.database
		]);
		if (!exists.rowCount) await maintenance.query('CREATE DATABASE vapourdb_test');
	} catch (error) {
		console.error(
			`Could not prepare disposable vapourdb_test with the configured CI account (${error.code === '42501' ? 'CREATEDB permission is required' : 'PostgreSQL connection failed'}).`
		);
		return 1;
	} finally {
		await maintenance?.end().catch(() => {});
	}

	const client = new pg.Client(connection.options);
	try {
		await client.connect();
		const actual = await client.query('SELECT current_database() AS database');
		if (actual.rows[0]?.database !== 'vapourdb_test')
			throw new Error('The configured test connection did not reach vapourdb_test.');
		const markerExists = await client.query('SELECT to_regclass($1) AS marker', [
			`public.${identity.markerTable}`
		]);
		if (markerExists.rows[0]?.marker) {
			const marker = await client.query(
				`SELECT marker FROM public.${identity.markerTable} WHERE id = 1`
			);
			if (marker.rows[0]?.marker !== identity.markerValue)
				throw new Error('Existing test database safety marker is invalid.');
		} else {
			const objects = await client.query(
				`SELECT count(*)::int AS count FROM pg_class c
				 JOIN pg_namespace n ON n.oid = c.relnamespace
				 WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
				   AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')`
			);
			const schemas = await client.query(
				`SELECT count(*)::int AS count FROM pg_namespace
				 WHERE nspname NOT LIKE 'pg_%' AND nspname NOT IN ('information_schema', 'public')`
			);
			if (objects.rows[0].count || schemas.rows[0].count)
				throw new Error('Refusing to mark an unmarked database that contains existing objects.');
			await client.query(
				`CREATE TABLE public.${identity.markerTable} (id integer PRIMARY KEY CHECK (id = 1), marker text NOT NULL)`
			);
			await client.query(`INSERT INTO public.${identity.markerTable} (id, marker) VALUES (1, $1)`, [
				identity.markerValue
			]);
		}
		console.log('Verified the explicit safety marker in disposable vapourdb_test.');
		return 0;
	} catch (error) {
		console.error(`Test database preparation failed: ${error.message}`);
		return 1;
	} finally {
		await client.end().catch(() => {});
	}
}

process.exitCode = await main();
