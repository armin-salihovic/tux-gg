#!/usr/bin/env node

import {
	createDatabaseClient,
	preflightDatabase,
	resolveDatabaseUrl
} from './database-connection.mjs';

let expectedRows;
for (let index = 0; index < process.argv.length; index += 1) {
	if (process.argv[index] !== '--expect') continue;
	expectedRows = Number(process.argv[index + 1]);
	if (!Number.isInteger(expectedRows) || expectedRows < 0) {
		console.error('--expect requires a nonnegative row count.');
		process.exit(2);
	}
	index += 1;
}

const connection = resolveDatabaseUrl('steamRead');
let client;
try {
	await preflightDatabase(connection, { operation: 'steamRead', requireLocalOwner: false });
	client = createDatabaseClient(connection.raw, 'vapourdb-games-count');
	await client.connect();
	await client.query('BEGIN READ ONLY');
	const result = await client.query(
		'SELECT count(*)::bigint AS rows, count(DISTINCT app_id)::bigint AS distinct_app_ids FROM public.games'
	);
	console.log(
		`Games: rows=${result.rows[0].rows} distinct_app_ids=${result.rows[0].distinct_app_ids}`
	);
	if (result.rows[0].rows !== result.rows[0].distinct_app_ids)
		throw new Error('Catalog row count and distinct AppID count do not match.');
	if (expectedRows !== undefined && result.rows[0].rows !== String(expectedRows))
		throw new Error(`Expected ${expectedRows} catalog rows.`);
	await client.query('COMMIT');
} catch (error) {
	console.error(`Read-only games count failed: ${error.category ?? error.message}`);
	process.exitCode = 1;
	if (client) await client.query('ROLLBACK').catch(() => {});
} finally {
	if (client) await client.end().catch(() => {});
}
