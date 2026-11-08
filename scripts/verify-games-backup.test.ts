import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyGamesBackup } from './verify_games_backup.mjs';

const temporaryDirectories: string[] = [];

async function createBackup(prefix: 'tuxgg' | 'vapourdb') {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'vapourdb-backup-manifest-'));
	temporaryDirectories.push(directory);
	const csvName = `${prefix}-games-20261108.csv`;
	const archiveName = `${prefix}-games-20261108.dump`;
	const csvPath = path.join(directory, csvName);
	const archivePath = path.join(directory, archiveName);
	const csv =
		'app_id,title,slug,artwork_url,header_image_url,metadata,created_at,updated_at\n' +
		'440,Team Fortress 2,team-fortress-2,\\N,\\N,"{""steam"":{""retained"":true}}",2020-01-02T03:04:05.000Z,2024-06-07T08:09:10.000Z\n';
	const archive = 'verified custom archive bytes';
	await writeFile(csvPath, csv, { mode: 0o600 });
	await writeFile(archivePath, archive, { mode: 0o600 });
	const format = prefix === 'tuxgg' ? 'tuxgg-games-backup-v1' : 'vapourdb-games-backup-v1';
	await writeFile(
		path.join(directory, `${prefix}-games-20261108.manifest.json`),
		JSON.stringify({
			format,
			database: prefix,
			originalCount: 1,
			csvCount: 1,
			archiveRestoredRows: 1,
			representativeRecordsCompared: 1,
			csvFile: csvName,
			csvSha256: createHash('sha256').update(csv).digest('hex'),
			archiveFile: archiveName,
			archiveSha256: createHash('sha256').update(archive).digest('hex')
		}),
		{ mode: 0o600 }
	);
	return csvPath;
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true }))
	);
});

describe('verified games backup manifests', () => {
	it('accepts and checksum-verifies legacy TuxGG CSV and archive names', async () => {
		const backup = await verifyGamesBackup(await createBackup('tuxgg'));
		expect(backup.manifest.format).toBe('tuxgg-games-backup-v1');
		expect(backup.verificationLevel).toBe('full-disposable-restore');
		expect(backup.games.map((game) => game.app_id)).toEqual(['440']);
		expect(backup.games[0]?.metadata).toBe('{"steam":{"retained":true}}');
	});

	it('accepts and checksum-verifies new VapourDB backup names', async () => {
		const backup = await verifyGamesBackup(await createBackup('vapourdb'));
		expect(backup.manifest.format).toBe('vapourdb-games-backup-v1');
		expect(backup.verificationLevel).toBe('full-disposable-restore');
		expect(backup.games.map((game) => game.app_id)).toEqual(['440']);
	});

	it('accepts a full disposable restore with no representative rows for an empty catalog', async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), 'vapourdb-backup-empty-'));
		temporaryDirectories.push(directory);
		const csvName = 'vapourdb-games-20261108.csv';
		const archiveName = 'vapourdb-games-20261108.dump';
		const csv = 'app_id,title,slug,artwork_url,header_image_url,metadata,created_at,updated_at\n';
		const archive = 'empty custom archive bytes';
		const csvPath = path.join(directory, csvName);
		await writeFile(csvPath, csv);
		await writeFile(path.join(directory, archiveName), archive);
		await writeFile(
			path.join(directory, 'vapourdb-games-20261108.manifest.json'),
			JSON.stringify({
				format: 'vapourdb-games-backup-v1',
				verifiedAt: '2026-11-08T12:00:00.000Z',
				database: 'vapourdb',
				originalCount: 0,
				csvCount: 0,
				verificationLevel: 'full-disposable-restore',
				archiveRestoredRows: 0,
				representativeRecordsCompared: 0,
				csvFile: csvName,
				csvSha256: createHash('sha256').update(csv).digest('hex'),
				archiveFile: archiveName,
				archiveSha256: createHash('sha256').update(archive).digest('hex')
			})
		);
		const backup = await verifyGamesBackup(csvPath);
		expect(backup.verificationLevel).toBe('full-disposable-restore');
		expect(backup.games).toEqual([]);
	});

	it('accepts explicitly reduced evidence only when restore fields are null', async () => {
		const csvPath = await createBackup('vapourdb');
		const manifestPath = csvPath.replace(/\.csv$/, '.manifest.json');
		const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
		manifest.verifiedAt = '2026-11-08T12:00:00.000Z';
		manifest.verificationLevel = 'archive-readable';
		manifest.archiveRestoredRows = null;
		manifest.representativeRecordsCompared = null;
		await writeFile(manifestPath, JSON.stringify(manifest));
		const backup = await verifyGamesBackup(csvPath);
		expect(backup.verificationLevel).toBe('archive-readable');
		expect(backup.manifest.verificationLevel).toBe('archive-readable');
	});

	it('accepts and returns an explicit full disposable restore level', async () => {
		const csvPath = await createBackup('vapourdb');
		const manifestPath = csvPath.replace(/\.csv$/, '.manifest.json');
		const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
		manifest.verifiedAt = '2026-11-08T12:00:00.000Z';
		manifest.verificationLevel = 'full-disposable-restore';
		await writeFile(manifestPath, JSON.stringify(manifest));
		const backup = await verifyGamesBackup(csvPath);
		expect(backup.verificationLevel).toBe('full-disposable-restore');
	});

	it.each([
		['null row evidence', { archiveRestoredRows: null, representativeRecordsCompared: 1 }],
		['inconsistent row evidence', { archiveRestoredRows: 0, representativeRecordsCompared: 1 }],
		['missing sample evidence', { representativeRecordsCompared: null }],
		['fractional sample evidence', { representativeRecordsCompared: 0.5 }],
		['impossible sample evidence', { representativeRecordsCompared: 2 }]
	])('rejects falsified full restore manifests with %s', async (_label, fields) => {
		const csvPath = await createBackup('vapourdb');
		const manifestPath = csvPath.replace(/\.csv$/, '.manifest.json');
		const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
		manifest.verifiedAt = '2026-11-08T12:00:00.000Z';
		manifest.verificationLevel = 'full-disposable-restore';
		Object.assign(manifest, fields);
		await writeFile(manifestPath, JSON.stringify(manifest));
		await expect(verifyGamesBackup(csvPath)).rejects.toThrow(/Full restore verification evidence/);
	});

	it.each([
		['fabricated rows', { archiveRestoredRows: 1 }],
		['fabricated sample count', { representativeRecordsCompared: 1 }],
		['omitted row field', { archiveRestoredRows: undefined }]
	])('rejects reduced manifests with %s', async (_label, fields) => {
		const csvPath = await createBackup('vapourdb');
		const manifestPath = csvPath.replace(/\.csv$/, '.manifest.json');
		const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
		manifest.verifiedAt = '2026-11-08T12:00:00.000Z';
		manifest.verificationLevel = 'archive-readable';
		manifest.archiveRestoredRows = null;
		manifest.representativeRecordsCompared = null;
		Object.assign(manifest, fields);
		if (manifest.archiveRestoredRows === undefined) delete manifest.archiveRestoredRows;
		await writeFile(manifestPath, JSON.stringify(manifest));
		await expect(verifyGamesBackup(csvPath)).rejects.toThrow(/Reduced archive-readable/);
	});

	it('rejects unknown levels, invalid counts, mismatched dates, and traversal archive paths', async () => {
		for (const [change, message] of [
			[
				(manifest: Record<string, unknown>) => (manifest.verificationLevel = 'maybe'),
				/invalid or unknown/
			],
			[
				(manifest: Record<string, unknown>) => (manifest.originalCount = -1),
				/manifest is missing or incomplete/
			],
			[
				(manifest: Record<string, unknown>) => (manifest.verifiedAt = '2026-11-07T12:00:00.000Z'),
				/manifest date/
			],
			[
				(manifest: Record<string, unknown>) =>
					(manifest.archiveFile = '../vapourdb-games-20261108.dump'),
				/manifest is missing or incomplete/
			]
		] as const) {
			const csvPath = await createBackup('vapourdb');
			const manifestPath = csvPath.replace(/\.csv$/, '.manifest.json');
			const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
			manifest.verifiedAt = '2026-11-08T12:00:00.000Z';
			manifest.verificationLevel = 'full-disposable-restore';
			change(manifest);
			await writeFile(manifestPath, JSON.stringify(manifest));
			await expect(verifyGamesBackup(csvPath)).rejects.toThrow(message);
		}
	});

	it('rejects a checksum mismatch before a backup can be restored', async () => {
		const csvPath = await createBackup('tuxgg');
		await writeFile(csvPath, 'tampered backup', { flag: 'w' });
		await expect(verifyGamesBackup(csvPath)).rejects.toThrow(/checksum does not match/);
	});

	it('rejects a tampered archive checksum', async () => {
		const csvPath = await createBackup('vapourdb');
		const archivePath = csvPath.replace(/\.csv$/, '.dump');
		await writeFile(archivePath, 'tampered archive', { flag: 'w' });
		await expect(verifyGamesBackup(csvPath)).rejects.toThrow(/checksum does not match/);
	});

	it('rejects manifests that mix TuxGG and VapourDB names', async () => {
		const csvPath = await createBackup('vapourdb');
		const manifestPath = csvPath.replace(/\.csv$/, '.manifest.json');
		const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
		manifest.database = 'tuxgg';
		await writeFile(manifestPath, JSON.stringify(manifest));
		await expect(verifyGamesBackup(csvPath)).rejects.toThrow(/manifest is missing or incomplete/);

		const mismatchedFilenameCsv = await createBackup('vapourdb');
		const mismatchedFilenameManifest = mismatchedFilenameCsv.replace(/\.csv$/, '.manifest.json');
		const mismatchedFilename = JSON.parse(await readFile(mismatchedFilenameManifest, 'utf8'));
		mismatchedFilename.csvFile = 'tuxgg-games-20261108.csv';
		await writeFile(mismatchedFilenameManifest, JSON.stringify(mismatchedFilename));
		await expect(verifyGamesBackup(mismatchedFilenameCsv)).rejects.toThrow(
			/manifest is missing or incomplete/
		);
	});

	it('rejects a corrupt CSV and duplicate AppIDs even with current checksums', async () => {
		const csvPath = await createBackup('vapourdb');
		const originalCsv = await readFile(csvPath, 'utf8');
		const duplicateCsv = originalCsv + originalCsv.split('\n').at(-2) + '\n';
		await writeFile(csvPath, duplicateCsv);
		const manifestPath = csvPath.replace(/\.csv$/, '.manifest.json');
		const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
		manifest.csvSha256 = createHash('sha256').update(duplicateCsv).digest('hex');
		manifest.originalCount = 2;
		manifest.csvCount = 2;
		manifest.archiveRestoredRows = 2;
		await writeFile(manifestPath, JSON.stringify(manifest));
		await expect(verifyGamesBackup(csvPath)).rejects.toThrow(/duplicate AppID/);
	});
});
