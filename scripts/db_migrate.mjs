#!/usr/bin/env node

import { spawn } from 'node:child_process';
import path from 'node:path';
import {
	categorizeConnectionError,
	createDatabaseClient,
	preflightDatabase,
	resolveDatabaseUrl
} from './database-connection.mjs';

function sanitizeOutput(text, raw) {
	const encodedPassword = new URL(raw).password;
	const secrets = new Set([raw, encodedPassword]);
	try {
		secrets.add(decodeURIComponent(encodedPassword));
	} catch {
		// The raw URL pattern below still removes malformed or nonstandard URL text.
	}
	let result = text;
	for (const secret of secrets) if (secret) result = result.replaceAll(secret, '[redacted]');
	return result.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, '[redacted PostgreSQL URL]');
}

async function showBlockingSessions(connection) {
	const client = createDatabaseClient(connection, 'vapourdb-migration-diagnostics');
	try {
		await client.connect();
		const result = await client.query(
			`SELECT pid, usename, application_name, wait_event_type, wait_event,
			        pg_blocking_pids(pid) AS blocking_pids
			 FROM pg_stat_activity
			 WHERE datname = $1 AND pid <> pg_backend_pid()
			   AND cardinality(pg_blocking_pids(pid)) > 0
			 ORDER BY pid`,
			[connection.summary.database]
		);
		if (!result.rowCount) {
			console.error('No blocked PostgreSQL sessions were visible after the migration failed.');
			return;
		}
		console.error('Blocked PostgreSQL sessions (inspect these; none were terminated):');
		for (const row of result.rows)
			console.error(
				`  pid=${row.pid} role=${row.usename} app=${row.application_name} wait=${row.wait_event_type ?? 'unknown'}/${row.wait_event ?? 'unknown'} blockers=${row.blocking_pids.join(',')}`
			);
	} catch (error) {
		console.error(`Could not inspect migration blockers: ${categorizeConnectionError(error)}.`);
	} finally {
		await client.end().catch(() => {});
	}
}

async function main() {
	let connection;
	try {
		connection = resolveDatabaseUrl('migrate');
		const identity = await preflightDatabase(connection, { operation: 'migrate' });
		console.log(`Database preflight passed for ${identity.database} as ${identity.role}.`);
	} catch (error) {
		console.error(`Migration preflight failed: ${error.category ?? error.message}`);
		console.error(
			'Check the Docker published host port, DB_* target and password, plus CREATE on public and drizzle schemas.'
		);
		return 1;
	}

	const cliPath = path.resolve('node_modules/drizzle-kit/bin.cjs');
	const child = spawn(process.execPath, [cliPath, 'migrate'], {
		cwd: process.cwd(),
		env: process.env,
		windowsHide: true,
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let stdout = '';
	let stderr = '';
	child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
	child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
	const result = await new Promise((resolve) => child.on('close', (code) => resolve(code ?? 1)));
	if (stdout) process.stdout.write(sanitizeOutput(stdout, connection.raw));
	if (stderr) process.stderr.write(sanitizeOutput(stderr, connection.raw));
	if (result !== 0) {
		console.error(
			'Drizzle migration failed. The URL preflight passed; inspect migration SQL and database locks.'
		);
		await showBlockingSessions(connection);
	}
	return result;
}

process.exitCode = await main();
