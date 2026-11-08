#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomInt } from 'node:crypto';
import { copyFile, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';
import { loadLocalEnv, parseGamesCsv } from './games-catalog.mjs';
import { verifyGamesBackup } from './verify_games_backup.mjs';
import { DATABASE_IDENTITIES } from './database-identifiers.mjs';
import { requireDatabaseRoleUrl } from './database-safety.mjs';

loadLocalEnv();

function run(command, args, env) {
	const result = spawnSync(command, args, {
		cwd: process.cwd(),
		encoding: 'utf8',
		env,
		windowsHide: true
	});
	if (result.status !== 0)
		throw new Error(
			`${path.basename(command)} failed (${result.status ?? 'signal'}). ${result.stderr.slice(-2000)}`
		);
	return result.stdout;
}

function requireTestUrl(raw, variable, role) {
	const { url, database } = requireDatabaseRoleUrl(raw, variable, role, true);
	const identity = DATABASE_IDENTITIES.vapourdb;
	if (database !== identity.test)
		throw new Error(`${variable} must use ${role} on the marked ${identity.test} database.`);
	return url;
}

async function sha256(filePath) {
	return createHash('sha256')
		.update(await readFile(filePath))
		.digest('hex');
}

async function main() {
	const localEnv = dotenv.parse(await readFile('.env', 'utf8').catch(() => ''));
	const sourceUrl = process.env.MIGRATION_DATABASE_URL || localEnv.MIGRATION_DATABASE_URL;
	const importerUrl = process.env.IMPORTER_DATABASE_URL || localEnv.IMPORTER_DATABASE_URL;
	const testAdminUrl = process.env.TEST_DATABASE_URL || localEnv.TEST_DATABASE_URL;
	const adminUrl = process.env.PGADMIN_URL || localEnv.PGADMIN_URL;
	const source = requireTestUrl(
		sourceUrl,
		'MIGRATION_DATABASE_URL',
		DATABASE_IDENTITIES.vapourdb.roles.migrator
	);
	const target = requireTestUrl(
		importerUrl,
		'IMPORTER_DATABASE_URL',
		DATABASE_IDENTITIES.vapourdb.roles.importer
	);
	const disposableAdmin = requireTestUrl(testAdminUrl, 'TEST_DATABASE_URL', 'postgres');
	if (!adminUrl || new URL(adminUrl).pathname.replace(/^\//, '') !== 'postgres')
		throw new Error(
			'PGADMIN_URL must be the PostgreSQL maintenance connection for the disposable CI server.'
		);
	const workDir = await mkdtemp(path.join(os.tmpdir(), 'vapourdb-backup-test-'));
	const sourceClient = new pg.Client({ connectionString: source.toString() });
	const targetClient = new pg.Client({ connectionString: target.toString() });
	const testAdmin = new pg.Client({ connectionString: disposableAdmin.toString() });
	const appIdPrefix = '999999999';
	const appIdA = `${appIdPrefix}${randomInt(100_000_000, 1_000_000_000)}`;
	let appIdB = `${appIdPrefix}${randomInt(100_000_000, 1_000_000_000)}`;
	while (appIdB === appIdA) appIdB = `${appIdPrefix}${randomInt(100_000_000, 1_000_000_000)}`;
	const createdAt = '2020-01-02T03:04:05.000Z';
	const updatedAt = '2024-06-07T08:09:10.000Z';
	const metadata = {
		steam: { note: 'café, 東京, "quoted" text\nsecond line', nested: { enabled: true } },
		custom: ['preserve', null, 3]
	};
	let markedTestDatabaseVerified = false;
	let fixtureMayExist = false;
	try {
		await sourceClient.connect();
		await targetClient.connect();
		await testAdmin.connect();
		const sourceIdentity = await sourceClient.query(
			'SELECT current_database() AS database, current_user AS role'
		);
		assert.deepEqual(sourceIdentity.rows[0], {
			database: DATABASE_IDENTITIES.vapourdb.test,
			role: DATABASE_IDENTITIES.vapourdb.roles.migrator
		});
		const targetIdentity = await targetClient.query(
			'SELECT current_database() AS database, current_user AS role'
		);
		assert.deepEqual(targetIdentity.rows[0], {
			database: DATABASE_IDENTITIES.vapourdb.test,
			role: DATABASE_IDENTITIES.vapourdb.roles.importer
		});
		const adminIdentity = await testAdmin.query(
			'SELECT current_database() AS database, current_user AS role'
		);
		assert.deepEqual(adminIdentity.rows[0], {
			database: DATABASE_IDENTITIES.vapourdb.test,
			role: 'postgres'
		});
		const marker = await testAdmin.query(
			`SELECT marker FROM public.${DATABASE_IDENTITIES.vapourdb.markerTable} WHERE id = 1`
		);
		assert.equal(marker.rows[0]?.marker, DATABASE_IDENTITIES.vapourdb.markerValue);
		markedTestDatabaseVerified = true;

		const existingFixture = await sourceClient.query(
			' SELECT app_id FROM public.games WHERE app_id = ANY($1::text[])',
			[[appIdA, appIdB]]
		);
		assert.equal(existingFixture.rowCount, 0, 'Generated fixture AppIDs must be unused.');
		fixtureMayExist = true;
		await sourceClient.query(
			`INSERT INTO public.games (app_id, title, slug, artwork_url, header_image_url, metadata, created_at, updated_at)
			 VALUES ($1, $2, $3, NULL, NULL, $4::jsonb, $5, $6),
			        ($7, NULL, $8, NULL, 'https://example.invalid/header.jpg', '{}'::jsonb, $5, $6)`,
			[
				appIdA,
				'Backup fixture, "quoted" café 東京\nsecond line',
				'backup-unicode-fixture',
				JSON.stringify(metadata),
				createdAt,
				updatedAt,
				appIdB,
				'backup-null-title'
			]
		);

		const backupDir = path.join(workDir, 'backup');
		const env = {
			...process.env,
			GAMES_BACKUP_DATABASE_URL: source.toString(),
			GAMES_BACKUP_VERIFY_ADMIN_URL: adminUrl,
			VAPOURDB_BACKUP_DIR: backupDir
		};
		const output = run(process.execPath, ['scripts/backup_games.mjs'], env);
		assert.match(output, /Games backup verified successfully\./);
		const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
		const csvPath = path.join(backupDir, `vapourdb-games-${stamp}.csv`);
		const dumpPath = path.join(backupDir, `vapourdb-games-${stamp}.dump`);
		const manifestPath = path.join(backupDir, `vapourdb-games-${stamp}.manifest.json`);
		assert.ok((await stat(csvPath)).size > 0);
		assert.ok((await stat(dumpPath)).size > 0);
		const csv = parseGamesCsv(csvPath);
		const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
		assert.equal(manifest.format, 'vapourdb-games-backup-v1');
		assert.equal(manifest.database, DATABASE_IDENTITIES.vapourdb.test);
		const fixture = csv.filter((row) => [appIdA, appIdB].includes(row.app_id));
		assert.equal(fixture.length, 2);
		const fixtureA = fixture.find((row) => row.app_id === appIdA);
		const fixtureB = fixture.find((row) => row.app_id === appIdB);
		assert.ok(fixtureA);
		assert.ok(fixtureB);
		assert.equal(fixtureA.title, 'Backup fixture, "quoted" café 東京\nsecond line');
		assert.equal(fixtureA.artwork_url, null);
		assert.deepEqual(JSON.parse(fixtureA.metadata), metadata);
		assert.equal(Date.parse(fixtureA.created_at), Date.parse(createdAt));
		assert.equal(Date.parse(fixtureA.updated_at), Date.parse(updatedAt));
		assert.equal(fixtureB.title, null);
		assert.equal(fixtureB.artwork_url, null);
		assert.equal(await sha256(csvPath), manifest.csvSha256);
		assert.equal(await sha256(dumpPath), manifest.archiveSha256);
		assert.equal((await verifyGamesBackup(csvPath)).games.length, csv.length);

		const legacyCsvPath = path.join(backupDir, `tuxgg-games-${stamp}.csv`);
		const legacyDumpPath = path.join(backupDir, `tuxgg-games-${stamp}.dump`);
		const legacyManifestPath = path.join(backupDir, `tuxgg-games-${stamp}.manifest.json`);
		await copyFile(csvPath, legacyCsvPath);
		await copyFile(dumpPath, legacyDumpPath);
		await writeFile(
			legacyManifestPath,
			JSON.stringify(
				{
					...manifest,
					format: 'tuxgg-games-backup-v1',
					database: 'tuxgg_test',
					csvFile: path.basename(legacyCsvPath),
					archiveFile: path.basename(legacyDumpPath)
				},
				null,
				2
			),
			{ mode: 0o600 }
		);
		const legacyBackup = await verifyGamesBackup(legacyCsvPath);
		assert.equal(legacyBackup.games.length, csv.length);
		assert.equal(legacyBackup.csvHash, await sha256(legacyCsvPath));
		assert.equal(legacyBackup.archiveHash, await sha256(legacyDumpPath));

		const countBefore = Number(
			(await targetClient.query('SELECT count(*)::int AS count FROM public.games')).rows[0].count
		);
		assert.equal(
			Number(
				(
					await targetClient.query(
						'SELECT count(*)::int AS count FROM public.games WHERE app_id = ANY($1::text[])',
						[[appIdA, appIdB]]
					)
				).rows[0].count
			),
			2
		);
		const restoreEnv = {
			...env,
			IMPORTER_DATABASE_URL: target.toString(),
			VAPOURDB_DATABASE_MODE: 'production'
		};
		run(process.execPath, ['scripts/restore_games.mjs', csvPath], restoreEnv);
		const countAfterFirst = Number(
			(await targetClient.query('SELECT count(*)::int AS count FROM public.games')).rows[0].count
		);
		run(process.execPath, ['scripts/restore_games.mjs', legacyCsvPath], restoreEnv);
		const countAfterSecond = Number(
			(await targetClient.query('SELECT count(*)::int AS count FROM public.games')).rows[0].count
		);
		assert.equal(countAfterFirst, countBefore);
		assert.equal(countAfterSecond, countAfterFirst);
		const restored = await targetClient.query(
			' SELECT app_id, title, artwork_url, metadata, created_at, updated_at FROM public.games WHERE app_id = ANY($1::text[]) ORDER BY app_id',
			[[appIdA, appIdB]]
		);
		assert.equal(restored.rows.length, 2);
		const restoredA = restored.rows.find((row) => row.app_id === appIdA);
		const restoredB = restored.rows.find((row) => row.app_id === appIdB);
		assert.ok(restoredA);
		assert.ok(restoredB);
		assert.deepEqual(restoredA.metadata, metadata);
		assert.equal(restoredA.created_at.toISOString(), createdAt);
		assert.equal(restoredA.updated_at.toISOString(), updatedAt);
		assert.equal(restoredB.title, null);
		assert.equal(restoredB.artwork_url, null);

		const duplicateCsv = path.join(workDir, 'duplicate.csv');
		const header = 'app_id,title,slug,artwork_url,header_image_url,metadata,created_at,updated_at';
		const row = `${appIdA},Title,slug,\\N,\\N,"{}",${createdAt},${updatedAt}`;
		await writeFile(duplicateCsv, `${header}\n${row}\n${row}\n`, 'utf8');
		assert.throws(() => parseGamesCsv(duplicateCsv), /duplicate AppID/);

		console.log(
			`Backup integration passed in marked ${DATABASE_IDENTITIES.vapourdb.test}: ${csv.length} CSV rows, new and legacy manifest checksums, custom archive restore, idempotent CSV restores, JSON/timestamps, Unicode/escaping/NULLs, and duplicate rejection.`
		);
	} finally {
		if (markedTestDatabaseVerified && fixtureMayExist)
			await sourceClient
				.query('DELETE FROM public.games WHERE app_id = ANY($1::text[])', [[appIdA, appIdB]])
				.catch(() => {});
		await Promise.all([
			sourceClient.end().catch(() => {}),
			targetClient.end().catch(() => {}),
			testAdmin.end().catch(() => {})
		]);
		await rm(workDir, { recursive: true, force: true });
	}
}

main().catch((error) => {
	console.error(
		`Games backup integration failed: ${error instanceof Error ? error.message : 'unknown error'}`
	);
	process.exitCode = 1;
});
