import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGamesCsv } from './games-catalog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SUPPORTED_FORMATS = new Set(['tuxgg-games-backup-v1', 'vapourdb-games-backup-v1']);
const VERIFICATION_LEVELS = new Set(['full-disposable-restore', 'archive-readable']);

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

function validDateStamp(stamp) {
	if (!/^\d{8}$/.test(stamp)) return false;
	const date = new Date(
		`${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T00:00:00.000Z`
	);
	return (
		Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10).replaceAll('-', '') === stamp
	);
}

function validateManifest(manifest, { brand, dateStamp, csvName, archiveName }) {
	if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return null;
	const normalizedBrand = brand.toLowerCase();
	const expectedFormat = `${normalizedBrand}-games-backup-v1`;
	const validDatabases = [normalizedBrand, `${normalizedBrand}_test`];
	if (
		!SUPPORTED_FORMATS.has(manifest.format) ||
		manifest.format !== expectedFormat ||
		!validDatabases.includes(manifest.database) ||
		manifest.csvFile !== csvName ||
		manifest.archiveFile !== archiveName ||
		!Number.isSafeInteger(manifest.originalCount) ||
		manifest.originalCount < 0 ||
		!Number.isSafeInteger(manifest.csvCount) ||
		manifest.csvCount !== manifest.originalCount ||
		!/^[a-f0-9]{64}$/i.test(manifest.csvSha256 ?? '') ||
		!/^[a-f0-9]{64}$/i.test(manifest.archiveSha256 ?? '')
	) {
		throw new Error('The games backup verification manifest is missing or incomplete.');
	}

	const explicitLevel = Object.hasOwn(manifest, 'verificationLevel');
	const level = explicitLevel ? manifest.verificationLevel : 'full-disposable-restore';
	if (!VERIFICATION_LEVELS.has(level)) {
		throw new Error('The games backup verification level is invalid or unknown.');
	}

	if (explicitLevel || Object.hasOwn(manifest, 'verifiedAt')) {
		const verifiedAt = manifest.verifiedAt;
		if (
			typeof verifiedAt !== 'string' ||
			!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(verifiedAt) ||
			!Number.isFinite(Date.parse(verifiedAt)) ||
			new Date(verifiedAt).toISOString().slice(0, 10).replaceAll('-', '') !== dateStamp
		) {
			throw new Error('The games backup manifest date does not match its filenames.');
		}
	}

	if (level === 'archive-readable') {
		if (
			!explicitLevel ||
			!Object.hasOwn(manifest, 'archiveRestoredRows') ||
			!Object.hasOwn(manifest, 'representativeRecordsCompared') ||
			manifest.archiveRestoredRows !== null ||
			manifest.representativeRecordsCompared !== null
		) {
			throw new Error('Reduced archive-readable manifests must have null restore evidence.');
		}
	} else {
		const restoredRows = manifest.archiveRestoredRows;
		const compared = manifest.representativeRecordsCompared;
		const validRepresentativeCount =
			Number.isSafeInteger(compared) &&
			(manifest.originalCount === 0
				? compared === 0
				: compared >= 1 && compared <= manifest.originalCount);
		if (
			!Number.isSafeInteger(restoredRows) ||
			restoredRows !== manifest.originalCount ||
			!validRepresentativeCount
		) {
			throw new Error(
				'Full restore verification evidence is missing, inconsistent, or impossible.'
			);
		}
	}
	return level;
}

export async function verifyGamesBackup(csvPath) {
	const resolvedCsv = path.resolve(csvPath);
	const [realCsv, realRoot] = await Promise.all([realpath(resolvedCsv), realpath(ROOT)]);
	if (isInside(realCsv, realRoot))
		throw new Error('The games backup must be outside the repository.');
	const csvName = path.basename(resolvedCsv);
	const csvMatch = csvName.match(/^(tuxgg|vapourdb)-games-(\d{8})\.csv$/);
	if (!csvMatch) throw new Error('The games backup CSV filename is not recognized.');
	const [, brand, dateStamp] = csvMatch;
	if (!validDateStamp(dateStamp)) throw new Error('The games backup filename date is invalid.');
	const archiveName = `${brand}-games-${dateStamp}.dump`;
	const manifestName = `${brand}-games-${dateStamp}.manifest.json`;
	const manifestPath = path.join(path.dirname(resolvedCsv), manifestName);
	const archivePath = path.join(path.dirname(resolvedCsv), archiveName);
	const [realManifest, realArchive] = await Promise.all([
		realpath(manifestPath),
		realpath(archivePath)
	]);
	if (
		path.basename(realManifest) !== manifestName ||
		path.basename(realArchive) !== archiveName ||
		path.dirname(realManifest) !== path.dirname(realCsv) ||
		path.dirname(realArchive) !== path.dirname(realCsv)
	) {
		throw new Error('The games backup manifest and archive must be alongside its CSV.');
	}
	const manifest = JSON.parse(await readFile(realManifest, 'utf8'));
	const verificationLevel = validateManifest(manifest, { brand, dateStamp, csvName, archiveName });
	if (!verificationLevel)
		throw new Error('The games backup verification manifest is missing or incomplete.');
	const [csvHash, archiveHash] = await Promise.all([sha256(realCsv), sha256(realArchive)]);
	if (csvHash !== manifest.csvSha256 || archiveHash !== manifest.archiveSha256) {
		throw new Error('The games backup checksum does not match its verification manifest.');
	}
	const games = parseGamesCsv(realCsv);
	if (games.length !== manifest.originalCount) {
		throw new Error('The verified backup CSV row count no longer matches its manifest.');
	}
	return {
		csvPath: realCsv,
		archivePath: realArchive,
		manifestPath: realManifest,
		games,
		csvHash,
		archiveHash,
		verificationLevel,
		manifest
	};
}
