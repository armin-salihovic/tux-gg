import { DATABASE_URL } from '$app/env/private';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '#lib/server/db/schema.js';

let pool: Pool | undefined;
let database: NodePgDatabase<typeof schema> | undefined;

export function getPool(): Pool {
	if (!DATABASE_URL) {
		throw new Error('Database is not configured. Set DATABASE_URL in the private environment.');
	}
	pool ??= new Pool({
		connectionString: DATABASE_URL,
		max: 10,
		idleTimeoutMillis: 30_000,
		connectionTimeoutMillis: 5_000,
		statement_timeout: 15_000,
		application_name: 'tuxgg-web'
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
