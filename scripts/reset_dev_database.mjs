#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadLocalEnv, parseGamesCsv } from './games-catalog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadLocalEnv();

function parseArgs(args) {
	const options = { force: false, games: null };
	for (let index = 0; index < args.length; index += 1) {
		if (args[index] === '--force') options.force = true;
		else if (args[index] === '--games') {
			options.games = args[++index];
			if (!options.games) throw new Error('--games requires the path to the verified games CSV.');
		} else throw new Error(`Unknown option: ${args[index]}`);
	}
	if (!options.force)
		throw new Error('Refusing destructive reset without the explicit --force flag.');
	return options;
}

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
	if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase())) {
		throw new Error(`${name} must connect to the local development server.`);
	}
	if (database !== expectedDatabase || user !== expectedRole) {
		throw new Error(`${name} must target ${expectedDatabase} using ${expectedRole}.`);
	}
	return url;
}

function isInside(candidate, root) {
	const relative = path.relative(root, candidate);
	return (
		relative === '' ||
		(!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
	);
}

async function sha256(filePath) {
	return createHash('sha256')
		.update(await readFile(filePath))
		.digest('hex');
}

async function verifyBackup(csvPath) {
	const resolvedCsv = path.resolve(csvPath);
	const [realCsv, realRoot] = await Promise.all([realpath(resolvedCsv), realpath(ROOT)]);
	if (isInside(realCsv, realRoot))
		throw new Error('The games backup must be outside the repository.');
	const manifestPath = resolvedCsv.replace(/\.csv$/i, '.manifest.json');
	const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
	if (
		manifest.format !== 'tuxgg-games-backup-v1' ||
		manifest.database !== 'tuxgg' ||
		manifest.csvFile !== path.basename(resolvedCsv) ||
		manifest.csvCount !== manifest.originalCount ||
		manifest.archiveRestoredRows !== manifest.originalCount ||
		manifest.representativeRecordsCompared < 1
	) {
		throw new Error('The games backup verification manifest is missing or incomplete.');
	}
	const archivePath = path.resolve(path.dirname(resolvedCsv), manifest.archiveFile);
	if (path.dirname(archivePath) !== path.dirname(resolvedCsv)) {
		throw new Error('The games backup archive must be alongside its CSV.');
	}
	const [csvHash, archiveHash] = await Promise.all([sha256(resolvedCsv), sha256(archivePath)]);
	if (csvHash !== manifest.csvSha256 || archiveHash !== manifest.archiveSha256) {
		throw new Error('The games backup checksum does not match its verification manifest.');
	}
	const games = parseGamesCsv(resolvedCsv);
	if (games.length !== manifest.originalCount) {
		throw new Error('The verified backup CSV row count no longer matches its manifest.');
	}
	return { csvPath: resolvedCsv, archivePath, manifestPath, games, csvHash, archiveHash };
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
	const options = parseArgs(process.argv.slice(2));
	if ((process.env.NODE_ENV || 'development') === 'production') {
		throw new Error('Refusing a development database reset when NODE_ENV is production.');
	}
	const migrationUrl = localPostgresUrl(
		process.env.MIGRATION_DATABASE_URL,
		'MIGRATION_DATABASE_URL',
		'tuxgg',
		'tuxgg_migrator'
	);
	const adminUrl = localPostgresUrl(process.env.PGADMIN_URL, 'PGADMIN_URL', 'postgres', 'postgres');
	const backup = options.games ? await verifyBackup(options.games) : null;
	if (backup)
		console.log(
			`Verified external games backup: ${backup.games.length} rows, CSV and archive checksums match.`
		);

	const migration = new pg.Client({ connectionString: migrationUrl.toString() });
	const targetAdminUrl = new URL(adminUrl.toString());
	targetAdminUrl.pathname = '/tuxgg';
	const admin = new pg.Client({ connectionString: targetAdminUrl.toString() });
	try {
		await migration.connect();
		const identity = await migration.query(
			`SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS address,
			        current_setting('server_version') AS version,
			        pg_get_userbyid(nspowner) AS schema_owner
			 FROM pg_namespace WHERE nspname = 'public'`
		);
		assert.equal(identity.rows[0]?.database, 'tuxgg');
		assert.equal(identity.rows[0]?.role, 'tuxgg_migrator');
		assert.equal(identity.rows[0]?.schema_owner, 'tuxgg_migrator');
		if (!identity.rows[0]?.address)
			throw new Error('The target PostgreSQL server did not identify a local TCP address.');
		await admin.connect();
		const adminIdentity = await admin.query(
			'SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS address'
		);
		assert.equal(adminIdentity.rows[0]?.database, 'tuxgg');
		assert.equal(adminIdentity.rows[0]?.role, 'postgres');
		assert.equal(adminIdentity.rows[0]?.address, identity.rows[0]?.address);

		const migrationSchema = await admin.query(
			`SELECT pg_get_userbyid(nspowner) AS owner,
			        to_json(ARRAY(SELECT tablename FROM pg_tables WHERE schemaname = 'drizzle' ORDER BY tablename)) AS tables
			 FROM pg_namespace WHERE nspname = 'drizzle'`
		);
		if (migrationSchema.rowCount) {
			assert.ok(['postgres', 'tuxgg_migrator'].includes(migrationSchema.rows[0].owner));
			assert.ok(migrationSchema.rows[0].tables.every((name) => name === '__drizzle_migrations'));
			await admin.query('DROP SCHEMA drizzle CASCADE');
		}
		await migration.query(
			'DROP SCHEMA public CASCADE; CREATE SCHEMA public AUTHORIZATION tuxgg_migrator'
		);
		await migration.query(
			'GRANT USAGE ON SCHEMA public TO tuxgg_web, tuxgg_importer, tuxgg_migrator'
		);
		console.log(`Reset local tuxgg schema on PostgreSQL ${identity.rows[0].version}.`);

		const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
		run(pnpm, ['db:migrate']);
		console.log('Applied the consolidated Drizzle baseline and recreated migration history.');
		run(pnpm, ['db:grant']);
		console.log('Reapplied TuxGG development database permissions.');
		if (backup) {
			run(process.execPath, ['scripts/restore_games.mjs', backup.csvPath]);
		}

		const expectedIds = backup?.games.map((game) => game.app_id) ?? [];
		const dbRows = await migration.query(
			`SELECT app_id, title, slug, artwork_url, header_image_url, metadata, created_at, updated_at
			 FROM public.games ORDER BY app_id`
		);
		const actualIds = dbRows.rows.map((row) => row.app_id);
		if (JSON.stringify(actualIds) !== JSON.stringify([...expectedIds].sort())) {
			throw new Error('The rebuilt database AppID set does not match the verified games backup.');
		}
		if (backup) {
			for (const expected of backup.games) {
				const actual = dbRows.rows.find((row) => row.app_id === expected.app_id);
				if (!actual) throw new Error(`Restored AppID ${expected.app_id} is missing.`);
				assert.equal(actual.title, expected.title);
				assert.equal(actual.slug, expected.slug);
				assert.equal(actual.artwork_url, expected.artwork_url);
				assert.equal(actual.header_image_url, expected.header_image_url);
				assert.deepEqual(actual.metadata, JSON.parse(expected.metadata));
				assert.equal(actual.created_at.toISOString(), new Date(expected.created_at).toISOString());
				assert.equal(actual.updated_at.toISOString(), new Date(expected.updated_at).toISOString());
			}
		}
		const tableResult = await migration.query(
			"SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
		);
		const actualTables = tableResult.rows.map((row) => row.tablename);
		const expectedTables = [
			'account',
			'games',
			'native_reports',
			'session',
			'user',
			'user_devices',
			'verification'
		];
		assert.deepEqual(actualTables, expectedTables);
		const privileges = await migration.query(
			`SELECT has_table_privilege('tuxgg_web', 'public.games', 'SELECT') AS web_read,
			        has_table_privilege('tuxgg_web', 'public.games', 'INSERT') AS web_insert,
			        has_table_privilege('tuxgg_importer', 'public.games', 'INSERT') AS importer_insert,
			        has_table_privilege('tuxgg_web', 'public.user_devices', 'SELECT') AS devices_read`
		);
		assert.deepEqual(privileges.rows[0], {
			web_read: true,
			web_insert: false,
			importer_insert: true,
			devices_read: true
		});
		console.log(
			`Verified clean schema, migration ledger, permissions, and ${dbRows.rows.length} restored games.`
		);
		console.log('No obsolete import or compatibility-summary tables remain.');
	} finally {
		await Promise.all([migration.end().catch(() => {}), admin.end().catch(() => {})]);
	}
}

main().catch((error) => {
	console.error(
		`Development database reset failed: ${error instanceof Error ? error.message : 'unknown error'}`
	);
	process.exitCode = 1;
});
