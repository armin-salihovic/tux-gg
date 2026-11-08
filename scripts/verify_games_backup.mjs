import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGamesCsv } from './games-catalog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SUPPORTED_FORMATS = new Set(['tuxgg-games-backup-v1', 'vapourdb-games-backup-v1']);

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

export async function verifyGamesBackup(csvPath) {
	const resolvedCsv = path.resolve(csvPath);
	const [realCsv, realRoot] = await Promise.all([realpath(resolvedCsv), realpath(ROOT)]);
	if (isInside(realCsv, realRoot))
		throw new Error('The games backup must be outside the repository.');
	const csvName = path.basename(resolvedCsv);
	const csvMatch = csvName.match(/^(tuxgg|vapourdb)-games-(\d{8})\.csv$/i);
	if (!csvMatch) throw new Error('The games backup CSV filename is not recognized.');
	const [, brand, dateStamp] = csvMatch;
	const expectedFormat = `${brand.toLowerCase()}-games-backup-v1`;
	const manifestPath = resolvedCsv.replace(/\.csv$/i, '.manifest.json');
	const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
	if (
		!SUPPORTED_FORMATS.has(manifest.format) ||
		manifest.format !== expectedFormat ||
		![brand.toLowerCase(), `${brand.toLowerCase()}_test`].includes(manifest.database) ||
		manifest.csvFile !== csvName ||
		manifest.csvCount !== manifest.originalCount ||
		manifest.archiveRestoredRows !== manifest.originalCount ||
		manifest.representativeRecordsCompared < 1 ||
		!/^[a-f0-9]{64}$/i.test(manifest.csvSha256 ?? '') ||
		!/^[a-f0-9]{64}$/i.test(manifest.archiveSha256 ?? '')
	) {
		throw new Error('The games backup verification manifest is missing or incomplete.');
	}
	const archivePath = path.resolve(path.dirname(resolvedCsv), manifest.archiveFile);
	if (
		path.dirname(archivePath) !== path.dirname(resolvedCsv) ||
		path.basename(archivePath) !== `${brand}-games-${dateStamp}.dump`
	) {
		throw new Error('The games backup archive must be a matching archive alongside its CSV.');
	}
	const [csvHash, archiveHash] = await Promise.all([sha256(resolvedCsv), sha256(archivePath)]);
	if (csvHash !== manifest.csvSha256 || archiveHash !== manifest.archiveSha256) {
		throw new Error('The games backup checksum does not match its verification manifest.');
	}
	const games = parseGamesCsv(resolvedCsv);
	if (games.length !== manifest.originalCount) {
		throw new Error('The verified backup CSV row count no longer matches its manifest.');
	}
	return { csvPath: resolvedCsv, archivePath, manifestPath, games, csvHash, archiveHash, manifest };
}
