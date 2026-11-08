import {
	DB_CONNECTION,
	DB_DATABASE,
	DB_HOST,
	DB_PASSWORD,
	DB_PORT,
	DB_USERNAME
} from '$app/env/private';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '#lib/server/db/schema.js';
import {
	validateRuntimeDatabaseTarget,
	verifyRuntimeDatabaseIdentity as verifyTargetIdentity
} from './database-target.js';

let pool: Pool | undefined;
let database: NodePgDatabase<typeof schema> | undefined;
let identityCheck: Promise<void> | undefined;

export function assertRuntimeDatabaseTarget(): boolean {
	if (DB_DATABASE) validateRuntimeDatabaseTarget(DB_DATABASE, process.env);
	return Boolean(DB_DATABASE);
}

export function getPool(): Pool {
	if (
		DB_CONNECTION?.toLowerCase() !== 'pgsql' ||
		!DB_HOST ||
		!DB_PORT ||
		!DB_DATABASE ||
		!DB_USERNAME
	) {
		throw new Error(
			'Database is not configured. Set DB_CONNECTION=pgsql and the DB_* fields in .env.'
		);
	}
	validateRuntimeDatabaseTarget(DB_DATABASE, process.env);
	pool ??= new Pool({
		host: DB_HOST,
		port: Number(DB_PORT),
		database: DB_DATABASE,
		user: DB_USERNAME,
		password: DB_PASSWORD ?? '',
		max: 10,
		idleTimeoutMillis: 30_000,
		connectionTimeoutMillis: 5_000,
		statement_timeout: 15_000,
		application_name: 'vapourdb-web'
	});
	return pool;
}

export async function verifyRuntimeDatabaseIdentity(): Promise<void> {
	const target = validateRuntimeDatabaseTarget(DB_DATABASE, process.env);
	identityCheck ??= (async () => {
		const client = await getPool().connect();
		try {
			await verifyTargetIdentity((query) => client.query(query), target);
		} finally {
			client.release();
		}
	})();
	try {
		await identityCheck;
	} catch (error) {
		identityCheck = undefined;
		throw error;
	}
}

export function getDb(): NodePgDatabase<typeof schema> {
	database ??= drizzle(getPool(), { schema });
	return database;
}

export async function closeDatabase(): Promise<void> {
	if (pool) {
		await pool.end();
		pool = undefined;
		database = undefined;
		identityCheck = undefined;
	}
}
