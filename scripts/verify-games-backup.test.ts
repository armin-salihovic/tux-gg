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
		expect(backup.games.map((game) => game.app_id)).toEqual(['440']);
		expect(backup.games[0]?.metadata).toBe('{"steam":{"retained":true}}');
	});

	it('accepts and checksum-verifies new VapourDB backup names', async () => {
		const backup = await verifyGamesBackup(await createBackup('vapourdb'));
		expect(backup.manifest.format).toBe('vapourdb-games-backup-v1');
		expect(backup.games.map((game) => game.app_id)).toEqual(['440']);
	});

	it('rejects a checksum mismatch before a backup can be restored', async () => {
		const csvPath = await createBackup('tuxgg');
		await writeFile(csvPath, 'tampered backup', { flag: 'w' });
		await expect(verifyGamesBackup(csvPath)).rejects.toThrow(/checksum does not match/);
	});

	it('rejects manifests that mix TuxGG and VapourDB names', async () => {
		const csvPath = await createBackup('vapourdb');
		const manifestPath = csvPath.replace(/\.csv$/, '.manifest.json');
		const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
		manifest.database = 'tuxgg';
		await writeFile(manifestPath, JSON.stringify(manifest));
		await expect(verifyGamesBackup(csvPath)).rejects.toThrow(/manifest is missing or incomplete/);
	});
});
