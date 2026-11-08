#!/usr/bin/env node

import pg from 'pg';
import { categorizeConnectionError, resolveDatabaseUrl } from './database-connection.mjs';

async function openClient(options) {
	const client = new pg.Client({
		...options,
		connectionTimeoutMillis: 5000,
		query_timeout: 5000,
		statement_timeout: 5000,
		application_name: 'vapourdb-db-setup'
	});
	try {
		await client.connect();
		return client;
	} catch (error) {
		await client.end().catch(() => {});
		throw error;
	}
}

async function readPermissions(client) {
	const result = await client.query(
		`SELECT current_database() AS database, current_user AS username,
		        has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_database_objects,
		        has_schema_privilege(current_user, 'public', 'USAGE') AS can_use_public,
		        has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_public,
		        to_regnamespace('drizzle') IS NOT NULL AS drizzle_exists,
		        CASE WHEN to_regnamespace('drizzle') IS NULL
		             THEN has_database_privilege(current_user, current_database(), 'CREATE')
		             ELSE has_schema_privilege(current_user, 'drizzle', 'USAGE')
		                  AND has_schema_privilege(current_user, 'drizzle', 'CREATE') END AS can_create_drizzle`
	);
	return result.rows[0];
}

async function ensureDatabase(connection) {
	try {
		const existing = await openClient(connection.options);
		const identity = await existing.query('SELECT current_database() AS database');
		await existing.end();
		if (identity.rows[0]?.database !== 'vapourdb')
			throw new Error('The configured login did not connect to vapourdb.');
		return;
	} catch (error) {
		if (error?.code !== '3D000') {
			const category = categorizeConnectionError(error);
			throw new Error(
				`${category}. Check DB_HOST, DB_PORT, DB_USERNAME and DB_PASSWORD; no credentials were printed.`
			);
		}
	}

	let maintenance;
	try {
		maintenance = await openClient({ ...connection.options, database: 'postgres' });
	} catch (error) {
		const category = categorizeConnectionError(error);
		throw new Error(
			`vapourdb does not exist and the configured login could not connect to PostgreSQL's postgres maintenance database (${category}). The same DB_USERNAME needs access to postgres and CREATEDB (or superuser) to create vapourdb.`
		);
	}
	try {
		const identity = await maintenance.query('SELECT current_database() AS database');
		if (identity.rows[0]?.database !== 'postgres')
			throw new Error('Could not verify PostgreSQL maintenance database identity.');
		await maintenance.query('CREATE DATABASE vapourdb');
		console.log('Created the missing vapourdb database using the configured DB_* login.');
	} catch (error) {
		if (error?.code === '42P04') {
			// Another setup process created it after the initial connection check.
		} else if (error?.code === '42501') {
			throw new Error(
				'The configured DB_USERNAME lacks CREATEDB permission. Grant CREATEDB to this same login, then rerun pnpm db:setup.'
			);
		} else {
			throw new Error(`Could not create vapourdb (${categorizeConnectionError(error)}).`);
		}
	} finally {
		await maintenance.end().catch(() => {});
	}

	let verified;
	try {
		verified = await openClient(connection.options);
	} catch (error) {
		throw new Error(
			`vapourdb was created but the configured login could not reconnect to it (${categorizeConnectionError(error)}).`
		);
	}
	const identity = await verified.query('SELECT current_database() AS database');
	await verified.end();
	if (identity.rows[0]?.database !== 'vapourdb')
		throw new Error('PostgreSQL did not reconnect to the configured vapourdb target.');
}

async function main() {
	let connection;
	try {
		connection = resolveDatabaseUrl('setup');
	} catch (error) {
		console.error(error.message);
		return 1;
	}
	if (connection.summary.database !== 'vapourdb') {
		console.error(
			'DB_DATABASE must be exactly vapourdb. Setup never acts on legacy or test databases.'
		);
		return 1;
	}
	try {
		await ensureDatabase(connection);
		const client = await openClient(connection.options);
		try {
			const publicState = await client.query(
				`SELECT to_regnamespace('public') IS NOT NULL AS public_exists,
				        has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_schema`
			);
			if (!publicState.rows[0]?.public_exists) {
				if (!publicState.rows[0]?.can_create_schema)
					throw new Error(
						'The public schema is missing and the configured DB_USERNAME needs CREATE on database vapourdb to prepare it.'
					);
				await client.query('CREATE SCHEMA public');
			}
			let permissions = await readPermissions(client);
			if (permissions.database !== 'vapourdb')
				throw new Error('Connected database identity does not match DB_DATABASE=vapourdb.');
			if (!permissions.drizzle_exists && permissions.can_create_database_objects) {
				await client.query('CREATE SCHEMA drizzle');
				permissions = await readPermissions(client);
			}
			const missing = [];
			if (!permissions.can_use_public)
				missing.push('USAGE on schema public (required to access application objects)');
			if (!permissions.can_create_public)
				missing.push('CREATE on schema public (required for application tables and migrations)');
			if (!permissions.can_create_drizzle)
				missing.push('CREATE on schema drizzle (required for Drizzle migration history)');
			if (missing.length)
				throw new Error(`The configured DB_USERNAME needs ${missing.join(' and ')} in vapourdb.`);
			console.log(
				`Setup verified: database=${permissions.database} username=${permissions.username}; public and Drizzle schemas are writable. No existing data or migration history was reset.`
			);
		} finally {
			await client.end().catch(() => {});
		}
		return 0;
	} catch (error) {
		console.error(`Database setup failed: ${error.message}`);
		return 1;
	}
}

process.exitCode = await main();
