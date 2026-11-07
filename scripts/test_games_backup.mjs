#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash, randomInt } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';
import { loadLocalEnv, parseGamesCsv } from './games-catalog.mjs';

loadLocalEnv();

function run(command, args, env) {
	const result = spawnSync(command, args, {
		cwd: process.cwd(),
		encoding: 'utf8',
		env,
		windowsHide: true
	});
	if (result.status !== 0) {
		throw new Error(
			`${path.basename(command)} failed (${result.status ?? 'signal'}). ${result.stderr.slice(-2000)}`
		);
	}
	return result.stdout;
}

async function sha256(filePath) {
	return createHash('sha256')
		.update(await readFile(filePath))
		.digest('hex');
}

async function main() {
	const localEnv = dotenv.parse(await readFile('.env', 'utf8').catch(() => ''));
	const sourceUrl =
		process.env.GAMES_BACKUP_DATABASE_URL ||
		localEnv.MIGRATION_DATABASE_URL ||
		process.env.MIGRATION_DATABASE_URL;
	const adminUrl = process.env.GAMES_BACKUP_VERIFY_ADMIN_URL || process.env.PGADMIN_URL;
	const importerUrl = process.env.IMPORTER_DATABASE_URL;
	const testAdminUrl = process.env.TEST_DATABASE_URL;
	if (!sourceUrl || !adminUrl || !importerUrl || !testAdminUrl) {
		throw new Error(
			'Backup integration tests require the disposable CI PostgreSQL URLs and importer role.'
		);
	}
	const importerIdentity = new URL(importerUrl);
	if (
		importerIdentity.username !== 'tuxgg_importer' ||
		importerIdentity.pathname.replace(/^\//, '') !== 'tuxgg_test'
	) {
		throw new Error(
			'IMPORTER_DATABASE_URL must use tuxgg_importer on the disposable tuxgg_test database.'
		);
	}
	const workDir = await mkdtemp(path.join(os.tmpdir(), 'tuxgg-backup-test-'));
	const source = new pg.Client({ connectionString: sourceUrl });
	const target = new pg.Client({ connectionString: importerUrl });
	const testAdmin = new pg.Client({ connectionString: testAdminUrl });
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
	try {
		await source.connect();
		const sourceIdentity = await source.query(
			'SELECT current_database() AS database FROM pg_catalog.pg_database WHERE datname = current_database()'
		);
		assert.equal(sourceIdentity.rows[0]?.database, 'tuxgg');
		const sourceFixtureCheck = await source.query(
			'SELECT app_id FROM public.games WHERE app_id = ANY($1::text[])',
			[[appIdA, appIdB]]
		);
		assert.equal(sourceFixtureCheck.rowCount, 0, 'Generated source fixture AppIDs must be unused.');
		await source.query(
			`INSERT INTO public.games (app_id, title, slug, artwork_url, header_image_url, metadata, created_at, updated_at)
			 VALUES ($1, $2, $3, NULL, NULL, $4::jsonb, $5, $6),
			        ($7, NULL, $8, NULL, 'https://example.invalid/header.jpg', '{}'::jsonb, $5, $6)
			 ON CONFLICT (app_id) DO UPDATE SET title = EXCLUDED.title, slug = EXCLUDED.slug,
			   artwork_url = EXCLUDED.artwork_url, header_image_url = EXCLUDED.header_image_url,
			   metadata = EXCLUDED.metadata, created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at`,
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
		await target.connect();
		const targetIdentity = await target.query(
			'SELECT current_database() AS database, current_user AS role'
		);
		assert.equal(targetIdentity.rows[0]?.database, 'tuxgg_test');
		assert.equal(targetIdentity.rows[0]?.role, 'tuxgg_importer');
		await testAdmin.connect();
		const adminIdentity = await testAdmin.query('SELECT current_database() AS database');
		assert.equal(adminIdentity.rows[0]?.database, 'tuxgg_test');
		const marker = await testAdmin.query(
			'SELECT marker FROM public.tuxgg_test_safety_marker WHERE id = 1'
		);
		assert.equal(marker.rows[0]?.marker, 'tuxgg_disposable_test_database_v1');
		const targetFixtureCheck = await target.query(
			'SELECT app_id FROM public.games WHERE app_id = ANY($1::text[])',
			[[appIdA, appIdB]]
		);
		assert.equal(targetFixtureCheck.rowCount, 0, 'Generated target fixture AppIDs must be unused.');

		const backupDir = path.join(workDir, 'backup');
		const env = {
			...process.env,
			GAMES_BACKUP_DATABASE_URL: sourceUrl,
			GAMES_BACKUP_VERIFY_ADMIN_URL: adminUrl,
			TUXGG_BACKUP_DIR: backupDir
		};
		const output = run(process.execPath, ['scripts/backup_games.mjs'], env);
		assert.match(output, /Games backup verified successfully\./);
		const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
		const csvPath = path.join(backupDir, `tuxgg-games-${stamp}.csv`);
		const dumpPath = path.join(backupDir, `tuxgg-games-${stamp}.dump`);
		assert.ok((await stat(csvPath)).size > 0);
		assert.ok((await stat(dumpPath)).size > 0);
		const csv = parseGamesCsv(csvPath);
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
		assert.equal(await sha256(csvPath), output.match(/CSV SHA-256: ([a-f0-9]{64})/)?.[1]);
		assert.equal(await sha256(dumpPath), output.match(/Archive SHA-256: ([a-f0-9]{64})/)?.[1]);

		const countBefore = Number(
			(await target.query('SELECT count(*)::int AS count FROM public.games')).rows[0].count
		);
		const overlapCount = Number(
			(
				await target.query(
					'SELECT count(*)::int AS count FROM public.games WHERE app_id = ANY($1::text[])',
					[csv.map((row) => row.app_id)]
				)
			).rows[0].count
		);
		const restoreEnv = { ...env, IMPORTER_DATABASE_URL: importerUrl };
		run(process.execPath, ['scripts/restore_games.mjs', csvPath], restoreEnv);
		const countAfterFirst = Number(
			(await target.query('SELECT count(*)::int AS count FROM public.games')).rows[0].count
		);
		run(process.execPath, ['scripts/restore_games.mjs', csvPath], restoreEnv);
		const countAfterSecond = Number(
			(await target.query('SELECT count(*)::int AS count FROM public.games')).rows[0].count
		);
		assert.equal(countAfterFirst, countBefore + csv.length - overlapCount);
		assert.equal(countAfterSecond, countAfterFirst);
		const restored = await target.query(
			'SELECT app_id, title, artwork_url, metadata, created_at, updated_at FROM public.games WHERE app_id = ANY($1::text[]) ORDER BY app_id',
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

		const refusalEnv = {
			...env,
			GAMES_BACKUP_DATABASE_URL: testAdminUrl,
			TUXGG_BACKUP_DIR: path.join(workDir, 'refusal')
		};
		const refusal = spawnSync(process.execPath, ['scripts/backup_games.mjs'], {
			cwd: process.cwd(),
			encoding: 'utf8',
			env: refusalEnv,
			windowsHide: true
		});
		assert.notEqual(refusal.status, 0);
		assert.match(refusal.stderr, /must connect to database tuxgg/);
		console.log(
			`Backup integration passed: ${csv.length} CSV rows, custom archive restore, CSV idempotency, JSON/timestamps, Unicode/escaping/NULLs, duplicate rejection, and unexpected-database refusal. SHA-256 ${await sha256(csvPath)} ${await sha256(dumpPath)}.`
		);
	} finally {
		await source
			.query('DELETE FROM public.games WHERE app_id = ANY($1::text[])', [[appIdA, appIdB]])
			.catch(() => {});
		await testAdmin
			.query('DELETE FROM public.games WHERE app_id = ANY($1::text[])', [[appIdA, appIdB]])
			.catch(() => {});
		await Promise.all([
			source.end().catch(() => {}),
			target.end().catch(() => {}),
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
