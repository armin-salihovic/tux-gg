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

let pool: Pool | undefined;
let database: NodePgDatabase<typeof schema> | undefined;

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

export function getDb(): NodePgDatabase<typeof schema> {
	database ??= drizzle(getPool(), { schema });
	return database;
}

export async function closeDatabase(): Promise<void> {
	if (pool) {
		await pool.end();
		pool = undefined;
		database = undefined;
	}
}
