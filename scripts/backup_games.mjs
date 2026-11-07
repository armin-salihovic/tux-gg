#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, readFileSync } from 'node:fs';
import { mkdir, open, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COLUMNS = [
	'app_id',
	'title',
	'slug',
	'artwork_url',
	'header_image_url',
	'metadata',
	'created_at',
	'updated_at'
];
const PAGE_SIZE = 2000;
const FAILURE = { stage: 'initialization' };

function loadLocalEnv() {
	const envPath = path.join(ROOT, '.env');
	try {
		const contents = requireTextFile(envPath);
		for (const line of contents.split(/\r?\n/)) {
			const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
			if (!match || match[1] in process.env) continue;
			let value = match[2];
			if (
				(value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'"))
			) {
				value = value.slice(1, -1);
				if (match[2].startsWith('"'))
					value = value
						.replace(/\\n/g, '\n')
						.replace(/\\r/g, '\r')
						.replace(/\\"/g, '"')
						.replace(/\\\\/g, '\\');
			} else {
				value = value.replace(/\s+#.*$/, '').trim();
			}
			process.env[match[1]] = value;
		}
	} catch (error) {
		if (error.code !== 'ENOENT') throw error;
	}
}

function requireTextFile(filePath) {
	// Read synchronously so .env values are available before pg's connection setup.
	return readFileSync(filePath, 'utf8');
}

function parseDatabaseUrl(raw, variableName) {
	if (!raw) throw new Error(`${variableName} is not configured.`);
	let url;
	try {
		url = new URL(raw);
	} catch {
		throw new Error(`${variableName} is not a valid PostgreSQL connection URL.`);
	}
	if (!/^postgres(?:ql)?:$/.test(url.protocol) || !url.hostname || !url.pathname.slice(1)) {
		throw new Error(`${variableName} must be a PostgreSQL URL with a host and database name.`);
	}
	return {
		url,
		host: url.hostname,
		port: url.port || '5432',
		user: decodeURIComponent(url.username),
		password: decodeURIComponent(url.password),
		database: decodeURIComponent(url.pathname.slice(1))
	};
}

function databaseUrlFor(database, source) {
	const url = new URL(source.url.toString());
	url.pathname = `/${encodeURIComponent(database)}`;
	return url.toString();
}

function insideRepository(candidate, repository) {
	const relative = path.relative(repository, candidate);
	return (
		relative === '' ||
		(!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
	);
}

async function makeBackupDirectory() {
	const configured = process.env.TUXGG_BACKUP_DIR;
	const backupDir = path.resolve(configured || path.join(os.homedir(), '.tuxgg-backups'));
	await mkdir(backupDir, { recursive: true, mode: 0o700 });
	const [realBackupDir, realRoot] = await Promise.all([realpath(backupDir), realpath(ROOT)]);
	if (insideRepository(realBackupDir, realRoot)) {
		throw new Error(
			'The backup directory must be outside the Git repository. Set TUXGG_BACKUP_DIR to a private external directory.'
		);
	}
	return realBackupDir;
}

function csvField(value) {
	if (value === null || value === undefined) return '\\N';
	return `"${String(value).replaceAll('"', '""')}"`;
}

async function writeCsvRow(handle, fields) {
	await handle.writeFile(`${fields.map(csvField).join(',')}\r\n`, 'utf8');
}

async function exportCsv(source, csvPath, count, appIds) {
	const handle = await open(csvPath, 'wx', 0o600);
	try {
		await writeCsvRow(handle, COLUMNS);
		let previousAppId = null;
		let written = 0;
		while (true) {
			const result = await source.query(
				`SELECT app_id, title, slug, artwork_url, header_image_url, metadata::text AS metadata,
				        created_at::text AS created_at, updated_at::text AS updated_at
				 FROM public.games
				 WHERE $1::text IS NULL OR app_id > $1::text
				 ORDER BY app_id
				 LIMIT $2`,
				[previousAppId, PAGE_SIZE]
			);
			if (result.rows.length === 0) break;
			for (const row of result.rows) {
				if (appIds.has(row.app_id)) throw new Error('The source table returned a duplicate AppID.');
				appIds.add(row.app_id);
				previousAppId = row.app_id;
				await writeCsvRow(
					handle,
					COLUMNS.map((column) => row[column])
				);
				written += 1;
			}
		}
		if (written !== count) throw new Error('The source row count changed during CSV export.');
	} finally {
		await handle.close();
	}
}

function csvVerifier(filePath, expectedIds, expectedCount) {
	return (async () => {
		let row = [];
		let field = '';
		let fieldQuoted = false;
		let inQuotes = false;
		let afterQuote = false;
		let pendingQuote = false;
		let pendingCarriageReturn = false;
		let records = 0;
		let dataRows = 0;
		const ids = new Set();
		const expectedHeader = COLUMNS;

		const pushField = () => {
			row.push(!fieldQuoted && field === '\\N' ? null : field);
			field = '';
			fieldQuoted = false;
			afterQuote = false;
		};
		const pushRecord = () => {
			pushField();
			if (records === 0) {
				if (
					row.length !== expectedHeader.length ||
					row.some((value, index) => value !== expectedHeader[index])
				) {
					throw new Error('The CSV header does not match the original games columns.');
				}
			} else {
				if (row.length !== expectedHeader.length)
					throw new Error('A CSV record has an unexpected number of columns.');
				const appId = row[0];
				if (typeof appId !== 'string' || appId.length === 0)
					throw new Error('A CSV record is missing its AppID.');
				if (ids.has(appId)) throw new Error('The CSV contains a duplicate AppID.');
				ids.add(appId);
				dataRows += 1;
			}
			records += 1;
			row = [];
		};

		for await (const chunk of createReadStream(filePath, { encoding: 'utf8' })) {
			for (let index = 0; index < chunk.length; index += 1) {
				const character = chunk[index];
				if (pendingCarriageReturn) {
					pendingCarriageReturn = false;
					pushRecord();
					if (character === '\n') continue;
				}
				if (pendingQuote) {
					pendingQuote = false;
					if (character === '"') {
						field += '"';
						continue;
					}
					inQuotes = false;
					afterQuote = true;
				}
				if (inQuotes) {
					if (character === '"') {
						if (index + 1 === chunk.length) {
							pendingQuote = true;
						} else if (chunk[index + 1] === '"') {
							field += '"';
							index += 1;
						} else {
							inQuotes = false;
							afterQuote = true;
						}
					} else {
						field += character;
					}
				} else if (character === '"') {
					if (field.length !== 0 || afterQuote || fieldQuoted)
						throw new Error('The CSV contains an invalid quote.');
					fieldQuoted = true;
					inQuotes = true;
				} else if (character === ',') {
					pushField();
				} else if (character === '\n') {
					pushRecord();
				} else if (character === '\r') {
					if (index + 1 === chunk.length) pendingCarriageReturn = true;
					else {
						if (chunk[index + 1] === '\n') index += 1;
						pushRecord();
					}
				} else {
					if (afterQuote) throw new Error('The CSV contains characters after a quoted field.');
					field += character;
				}
			}
		}
		if (pendingQuote) {
			pendingQuote = false;
			inQuotes = false;
			afterQuote = true;
		}
		if (pendingCarriageReturn) pushRecord();
		if (inQuotes) throw new Error('The CSV ends inside a quoted field.');
		if (field.length > 0 || row.length > 0 || fieldQuoted || afterQuote) pushRecord();
		if (records === 0 || dataRows !== expectedCount || ids.size !== expectedIds.size) {
			throw new Error('The CSV row count does not match the source table.');
		}
		for (const appId of expectedIds) {
			if (!ids.has(appId)) throw new Error('The CSV is missing an AppID from the source table.');
		}
		return dataRows;
	})();
}

function commandAvailable(command) {
	if (!command) return false;
	const result = spawnSync(command, ['--version'], { stdio: 'ignore', windowsHide: true });
	return result.status === 0;
}

function chooseClientTools() {
	const dump = process.env.TUXGG_PG_DUMP || 'pg_dump';
	const restore = process.env.TUXGG_PG_RESTORE || 'pg_restore';
	if (commandAvailable(dump) && commandAvailable(restore)) return { kind: 'host', dump, restore };
	if (
		(process.env.TUXGG_PG_DUMP || process.env.TUXGG_PG_RESTORE) &&
		(!commandAvailable(dump) || !commandAvailable(restore))
	) {
		throw new Error(
			'The configured TUXGG_PG_DUMP and TUXGG_PG_RESTORE utilities must both be executable.'
		);
	}
	if (commandAvailable('docker'))
		return {
			kind: 'docker',
			executable: 'docker',
			image: process.env.TUXGG_POSTGRES_CLIENT_IMAGE || 'postgres:18'
		};
	throw new Error(
		'PostgreSQL client tools were not found. Install pg_dump and pg_restore, or configure Docker.'
	);
}

function dockerHost(host) {
	if (['localhost', '127.0.0.1', '::1'].includes(host.toLowerCase())) return 'host.docker.internal';
	return host;
}

function pgpassEscape(value) {
	if (value.includes('\n') || value.includes('\r'))
		throw new Error('A database password contains an unsupported line break.');
	return value.replaceAll('\\', '\\\\').replaceAll(':', '\\:');
}

function connectionEnv(connection, passFile, container = false) {
	const host = container ? dockerHost(connection.host) : connection.host;
	const env = {
		...process.env,
		PGHOST: host,
		PGPORT: connection.port,
		PGUSER: connection.user,
		PGDATABASE: connection.database,
		PGPASSFILE: container ? '/work/pgpass' : passFile,
		PGAPPNAME: 'tuxgg-games-backup'
	};
	const sslMap = {
		sslmode: 'PGSSLMODE',
		sslrootcert: 'PGSSLROOTCERT',
		sslcert: 'PGSSLCERT',
		sslkey: 'PGSSLKEY',
		gssencmode: 'PGGSSENCMODE',
		target_session_attrs: 'PGTARGETSESSIONATTRS',
		application_name: 'PGAPPNAME'
	};
	for (const [queryKey, envKey] of Object.entries(sslMap)) {
		const value = connection.url.searchParams.get(queryKey);
		if (value) env[envKey] = value;
	}
	if (
		container &&
		['sslrootcert', 'sslcert', 'sslkey'].some((key) => connection.url.searchParams.has(key))
	) {
		throw new Error(
			'Docker client mode cannot use host-only TLS certificate paths. Install pg_dump and pg_restore on the host.'
		);
	}
	return env;
}

function hostForPassfile(connection, container) {
	return container ? dockerHost(connection.host) : connection.host;
}

async function writePassfile(filePath, connections, container) {
	const lines = [];
	for (const connection of connections) {
		lines.push(
			`${pgpassEscape(hostForPassfile(connection, container))}:${pgpassEscape(connection.port)}:*:${pgpassEscape(connection.user)}:${pgpassEscape(connection.password)}`
		);
	}
	await writeFile(filePath, `${lines.join('\n')}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
}

function safeDiagnostic(value) {
	let diagnostic = value;
	for (const variable of [
		'GAMES_BACKUP_DATABASE_URL',
		'DATABASE_URL',
		'GAMES_BACKUP_VERIFY_ADMIN_URL',
		'PGADMIN_URL'
	]) {
		const connection = process.env[variable];
		if (!connection) continue;
		diagnostic = diagnostic.replaceAll(connection, '<redacted PostgreSQL connection>');
		try {
			const password = decodeURIComponent(new URL(connection).password);
			if (password) diagnostic = diagnostic.replaceAll(password, '<redacted>');
		} catch {}
	}
	return diagnostic
		.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, '<redacted PostgreSQL connection>')
		.slice(-3000)
		.trim();
}

function runProcess(executable, args, env) {
	return new Promise((resolve, reject) => {
		const child = spawn(executable, args, {
			env,
			stdio: ['ignore', 'pipe', 'pipe'],
			windowsHide: true
		});
		let output = '';
		const collect = (chunk) => {
			output = `${output}${chunk.toString('utf8')}`.slice(-6000);
		};
		child.stdout.on('data', collect);
		child.stderr.on('data', collect);
		child.once('error', () =>
			reject(new Error('A PostgreSQL backup utility could not be started.'))
		);
		child.once('close', (code) =>
			code === 0
				? resolve()
				: reject(
						new Error(
							`A PostgreSQL backup utility exited with code ${code}.${output ? ` ${safeDiagnostic(output)}` : ''}`
						)
					)
		);
	});
}

function dockerArgs(engine, passFile, tool, args, connection) {
	const containerEnv = connectionEnv(connection, passFile, true);
	const environment = [
		'PGHOST',
		'PGPORT',
		'PGUSER',
		'PGDATABASE',
		'PGAPPNAME',
		'PGSSLMODE',
		'PGGSSENCMODE',
		'PGTARGETSESSIONATTRS'
	];
	const dockerEnvironment = environment.flatMap((key) =>
		containerEnv[key] ? ['--env', `${key}=${containerEnv[key]}`] : []
	);
	return [
		'run',
		'--rm',
		'--mount',
		`type=bind,source=${path.dirname(passFile)},target=/work`,
		'--user',
		'0:0',
		'--entrypoint',
		'/bin/sh',
		'--env',
		'PGPASSFILE=/tmp/tuxgg-pgpass',
		...dockerEnvironment,
		engine.image,
		'-c',
		'cp /work/pgpass /tmp/tuxgg-pgpass && chmod 600 /tmp/tuxgg-pgpass && exec "$@"',
		'tuxgg-backup-client',
		tool,
		...args
	];
}

async function runPgTool(engine, tool, args, connection, passFile) {
	if (engine.kind === 'host') {
		const executable = tool === 'pg_dump' ? engine.dump : engine.restore;
		const env = connectionEnv(connection, passFile);
		await runProcess(executable, args, env);
		return;
	}
	const mappedArgs = args.map((argument) => {
		const prefix = `${path.dirname(passFile)}${path.sep}`;
		if (argument.startsWith('--file=')) {
			const file = argument.slice('--file='.length);
			return file.startsWith(prefix) ? `--file=/work/${path.basename(file)}` : argument;
		}
		return argument.startsWith(prefix) ? `/work/${path.basename(argument)}` : argument;
	});
	const dockerOptions = dockerArgs(engine, passFile, tool, mappedArgs, connection);
	await runProcess(engine.executable, dockerOptions, process.env);
}

function connectionForDatabase(connection, database) {
	return { ...connection, database, url: new URL(databaseUrlFor(database, connection)) };
}

async function getSourceSamples(source, ids) {
	const sampleIds = [...ids.slice(0, 3), ...ids.slice(-1)];
	const metadataSample = await source.query(
		"SELECT app_id FROM public.games WHERE metadata <> '{}'::jsonb ORDER BY app_id LIMIT 1"
	);
	if (metadataSample.rows[0]) sampleIds.push(metadataSample.rows[0].app_id);
	const emptyMetadataOrMissingTitle = await source.query(
		"SELECT app_id FROM public.games WHERE title IS NULL OR metadata = '{}'::jsonb ORDER BY app_id LIMIT 1"
	);
	if (emptyMetadataOrMissingTitle.rows[0])
		sampleIds.push(emptyMetadataOrMissingTitle.rows[0].app_id);
	const uniqueIds = [...new Set(sampleIds)];
	if (uniqueIds.length === 0) return [];
	const result = await source.query(
		`SELECT app_id, title, slug, artwork_url, header_image_url, metadata::text AS metadata,
		        created_at::text AS created_at, updated_at::text AS updated_at
		 FROM public.games WHERE app_id = ANY($1::text[]) ORDER BY app_id`,
		[uniqueIds]
	);
	return result.rows;
}

async function compareRestoredData(adminUrl, database, expectedIds, sourceSamples) {
	const client = new pg.Client({
		connectionString: databaseUrlFor(database, adminUrl),
		connectionTimeoutMillis: 10000
	});
	await client.connect();
	try {
		await client.query("SET TIME ZONE 'UTC'");
		const counts = await client.query(
			'SELECT count(*)::bigint AS row_count, count(DISTINCT app_id)::bigint AS unique_app_ids FROM public.games'
		);
		if (
			counts.rows[0].row_count !== String(expectedIds.size) ||
			counts.rows[0].unique_app_ids !== String(expectedIds.size)
		) {
			throw new Error(
				'The disposable restore has an incorrect games row count or duplicate AppIDs.'
			);
		}
		const restoredIds = new Set();
		let previousAppId = null;
		while (true) {
			const page = await client.query(
				' SELECT app_id FROM public.games WHERE $1::text IS NULL OR app_id > $1::text ORDER BY app_id LIMIT $2',
				[previousAppId, PAGE_SIZE]
			);
			if (page.rows.length === 0) break;
			for (const row of page.rows) {
				if (restoredIds.has(row.app_id))
					throw new Error('The disposable restore contains a duplicate AppID.');
				restoredIds.add(row.app_id);
				previousAppId = row.app_id;
			}
		}
		if (
			restoredIds.size !== expectedIds.size ||
			[...expectedIds].some((id) => !restoredIds.has(id))
		) {
			throw new Error('The disposable restore does not contain every source AppID.');
		}
		if (sourceSamples.length > 0) {
			const sampleIds = sourceSamples.map((row) => row.app_id);
			const samples = await client.query(
				`SELECT app_id, title, slug, artwork_url, header_image_url, metadata::text AS metadata,
				        created_at::text AS created_at, updated_at::text AS updated_at
				 FROM public.games WHERE app_id = ANY($1::text[]) ORDER BY app_id`,
				[sampleIds]
			);
			if (samples.rows.length !== sourceSamples.length)
				throw new Error('A representative source record is missing after restore.');
			for (let index = 0; index < sourceSamples.length; index += 1) {
				for (const column of COLUMNS) {
					if (samples.rows[index][column] !== sourceSamples[index][column]) {
						throw new Error(`Representative game data did not match after restore (${column}).`);
					}
				}
			}
		}
		return {
			rows: Number(counts.rows[0].row_count),
			appIds: restoredIds.size,
			representativeRecords: sourceSamples.length
		};
	} finally {
		await client.end();
	}
}

async function sha256(filePath) {
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(filePath)) hash.update(chunk);
	return hash.digest('hex');
}

async function verifyDatabaseIdentity(client) {
	const result = await client.query(
		`SELECT current_database() AS database,
		        has_table_privilege(current_user, 'public.games', 'SELECT') AS can_read,
		        c.relrowsecurity AS row_security,
	        r.rolsuper AS is_superuser, r.rolbypassrls AS can_bypass_rls
		 FROM pg_class c
		 JOIN pg_namespace n ON n.oid = c.relnamespace
		 JOIN pg_roles r ON r.rolname = current_user
		 WHERE n.nspname = 'public' AND c.relname = 'games' AND c.relkind IN ('r', 'p')`
	);
	const identity = result.rows[0];
	if (!identity || identity.database !== 'tuxgg')
		throw new Error('DATABASE_URL must connect to database tuxgg.');
	if (!identity.can_read) throw new Error('DATABASE_URL must have SELECT access to public.games.');
	if (identity.row_security && !identity.is_superuser && !identity.can_bypass_rls) {
		throw new Error(
			'Row-level security is enabled on public.games; full-table export cannot be guaranteed with this role.'
		);
	}
	return identity;
}

async function verifyAdminIdentity(client) {
	const result = await client.query(
		`SELECT current_database() AS database,
		        EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolcreatedb) AS can_create_database`
	);
	if (result.rows[0].database !== 'postgres' || !result.rows[0].can_create_database) {
		throw new Error(
			'PGADMIN_URL must connect to the postgres maintenance database with permission to create a disposable database.'
		);
	}
}

async function run() {
	loadLocalEnv();
	FAILURE.stage = 'connection setup';
	const sourceUrl = parseDatabaseUrl(
		process.env.GAMES_BACKUP_DATABASE_URL || process.env.DATABASE_URL,
		'GAMES_BACKUP_DATABASE_URL or DATABASE_URL'
	);
	const adminUrl = parseDatabaseUrl(
		process.env.GAMES_BACKUP_VERIFY_ADMIN_URL || process.env.PGADMIN_URL,
		'GAMES_BACKUP_VERIFY_ADMIN_URL or PGADMIN_URL'
	);
	const backupDir = await makeBackupDirectory();
	const dateStamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
	const archivePath = path.join(backupDir, `tuxgg-games-${dateStamp}.dump`);
	const csvPath = path.join(backupDir, `tuxgg-games-${dateStamp}.csv`);
	const manifestPath = path.join(backupDir, `tuxgg-games-${dateStamp}.manifest.json`);
	for (const target of [archivePath, csvPath, manifestPath]) {
		try {
			await stat(target);
			throw new Error(
				'A games backup with today’s filename already exists. Move it aside before retrying.'
			);
		} catch (error) {
			if (error.code !== 'ENOENT') throw error;
		}
	}

	const engine = chooseClientTools();
	const workDir = path.join(
		backupDir,
		`.tuxgg-games-${process.pid}-${randomBytes(5).toString('hex')}`
	);
	const passFile = path.join(workDir, 'pgpass');
	const partialCsv = path.join(workDir, `tuxgg-games-${dateStamp}.csv.partial`);
	const partialDump = path.join(workDir, `tuxgg-games-${dateStamp}.dump.partial`);
	const verifyDb = `tuxgg_games_verify_${dateStamp}_${randomBytes(4).toString('hex')}`;
	let source;
	let admin;
	let createdVerifyDb = false;
	let publishedFiles = [];
	let resultSummary;

	try {
		await mkdir(workDir, { mode: 0o700 });
		await writePassfile(passFile, [sourceUrl, adminUrl], engine.kind === 'docker');
		FAILURE.stage = 'source database validation';
		source = new pg.Client({
			connectionString: sourceUrl.url.toString(),
			connectionTimeoutMillis: 10000
		});
		await source.connect();
		await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
		await source.query("SET LOCAL TIME ZONE 'UTC'");
		await source.query('SET LOCAL row_security = off');
		await verifyDatabaseIdentity(source);
		const counts = await source.query(
			'SELECT count(*)::bigint AS row_count, count(DISTINCT app_id)::bigint AS unique_app_ids FROM public.games'
		);
		const originalCount = Number(counts.rows[0].row_count);
		if (counts.rows[0].row_count !== counts.rows[0].unique_app_ids)
			throw new Error('The source games table contains duplicate AppIDs.');
		const snapshotResult = await source.query('SELECT pg_export_snapshot() AS snapshot');
		const snapshot = snapshotResult.rows[0].snapshot;
		const appIds = new Set();

		FAILURE.stage = 'CSV export';
		await exportCsv(source, partialCsv, originalCount, appIds);
		if (appIds.size !== originalCount)
			throw new Error('The source row count and unique AppID count do not match.');

		FAILURE.stage = 'custom archive export';
		const dumpArgs = [
			'--format=custom',
			'--no-owner',
			'--no-acl',
			'--no-password',
			'--table=public.games',
			`--snapshot=${snapshot}`,
			`--file=${partialDump}`
		];
		await runPgTool(engine, 'pg_dump', dumpArgs, sourceUrl, passFile);
		if ((await stat(partialDump)).size === 0) throw new Error('The PostgreSQL archive is empty.');

		FAILURE.stage = 'CSV verification';
		const csvCount = await csvVerifier(partialCsv, appIds, originalCount);

		FAILURE.stage = 'archive readability verification';
		await runPgTool(
			engine,
			'pg_restore',
			['--list', '--no-password', partialDump],
			adminUrl,
			passFile
		);
		const sourceSamples = await getSourceSamples(source, [...appIds]);

		FAILURE.stage = 'disposable restore verification';
		admin = new pg.Client({
			connectionString: adminUrl.url.toString(),
			connectionTimeoutMillis: 10000
		});
		await admin.connect();
		await verifyAdminIdentity(admin);
		await admin.query(`CREATE DATABASE "${verifyDb}"`);
		createdVerifyDb = true;
		const disposableUrl = connectionForDatabase(adminUrl, verifyDb);
		const disposable = new pg.Client({
			connectionString: disposableUrl.url.toString(),
			connectionTimeoutMillis: 10000
		});
		await disposable.connect();
		try {
			await disposable.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
		} finally {
			await disposable.end();
		}
		const restoreArgs = [
			'--exit-on-error',
			'--no-owner',
			'--no-acl',
			`--dbname=${verifyDb}`,
			partialDump
		];
		await runPgTool(engine, 'pg_restore', restoreArgs, disposableUrl, passFile);
		const restoreResult = await compareRestoredData(adminUrl, verifyDb, appIds, sourceSamples);
		await source.query('COMMIT');
		await source.end();
		source = undefined;
		await admin.query(`DROP DATABASE "${verifyDb}" WITH (FORCE)`);
		createdVerifyDb = false;
		await admin.end();
		admin = undefined;

		FAILURE.stage = 'publishing verified backup';
		await rename(partialCsv, csvPath);
		publishedFiles.push(csvPath);
		await rename(partialDump, archivePath);
		publishedFiles.push(archivePath);
		const [csvInfo, archiveInfo, csvHash, archiveHash] = await Promise.all([
			stat(csvPath),
			stat(archivePath),
			sha256(csvPath),
			sha256(archivePath)
		]);
		const manifest = {
			format: 'tuxgg-games-backup-v1',
			verifiedAt: new Date().toISOString(),
			database: 'tuxgg',
			originalCount,
			csvCount,
			archiveRestoredRows: restoreResult.rows,
			representativeRecordsCompared: restoreResult.representativeRecords,
			csvFile: path.basename(csvPath),
			csvSha256: csvHash,
			archiveFile: path.basename(archivePath),
			archiveSha256: archiveHash
		};
		await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
			encoding: 'utf8',
			mode: 0o600,
			flag: 'wx'
		});
		publishedFiles.push(manifestPath);
		resultSummary = {
			originalCount,
			csvCount,
			restoreResult,
			csvInfo,
			archiveInfo,
			csvHash,
			archiveHash,
			csvPath,
			archivePath,
			manifestPath
		};
	} catch (error) {
		for (const filePath of publishedFiles) await rm(filePath, { force: true }).catch(() => {});
		throw error;
	} finally {
		if (source) {
			await source.query('ROLLBACK').catch(() => {});
			await source.end().catch(() => {});
		}
		if (admin && createdVerifyDb) {
			await admin.query(`DROP DATABASE "${verifyDb}" WITH (FORCE)`).catch(() => {});
		}
		if (admin) await admin.end().catch(() => {});
		await rm(workDir, { recursive: true, force: true }).catch(() => {});
	}

	console.log('Games backup verified successfully.');
	console.log(`Source database: tuxgg`);
	console.log(`Original game records: ${resultSummary.originalCount}`);
	console.log(`CSV records verified: ${resultSummary.csvCount}`);
	console.log(`AppIDs preserved and unique: ${resultSummary.restoreResult.appIds}`);
	console.log('Custom archive readability: passed');
	console.log(
		`Disposable database restore: passed (${resultSummary.restoreResult.rows} rows; ${resultSummary.restoreResult.representativeRecords} representative records compared)`
	);
	console.log('Representative JSON metadata and timestamps: preserved');
	console.log(`CSV: ${resultSummary.csvPath} (${resultSummary.csvInfo.size} bytes)`);
	console.log(`CSV SHA-256: ${resultSummary.csvHash}`);
	console.log(`Archive: ${resultSummary.archivePath} (${resultSummary.archiveInfo.size} bytes)`);
	console.log(`Archive SHA-256: ${resultSummary.archiveHash}`);
	console.log(`Verification manifest: ${resultSummary.manifestPath}`);
}

run().catch((error) => {
	const detail = error instanceof Error ? error.message : 'an unknown error occurred';
	console.error(`Games backup failed during ${FAILURE.stage}: ${detail}`);
	process.exitCode = 1;
});
