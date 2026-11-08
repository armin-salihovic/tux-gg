import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { loadLocalEnv } from './games-catalog.mjs';
import { testIdentityForDatabase } from './database-identifiers.mjs';

export const CONNECT_TIMEOUT_MS = 5000;

export function normalizePnpmArgs(args) {
	return args[0] === '--' ? args.slice(1) : args;
}

export function safeUrlSummary(raw) {
	try {
		const url = new URL(raw);
		return {
			host: url.hostname,
			port: url.port || '5432',
			database: decodeURIComponent(url.pathname.slice(1)),
			username: decodeURIComponent(url.username)
		};
	} catch {
		throw new Error('Database connection settings are invalid.');
	}
}

function connectionString(options) {
	const url = new URL('postgresql://localhost');
	url.hostname = options.host;
	url.port = String(options.port);
	url.username = encodeURIComponent(options.user);
	url.password = encodeURIComponent(options.password);
	url.pathname = `/${encodeURIComponent(options.database)}`;
	return url.toString();
}

export function resolveDatabaseUrl(operation, env) {
	if (env === undefined) loadLocalEnv();
	if (
		!['setup', 'doctor', 'migrate', 'restore', 'steamWrite', 'steamRead', 'backup'].includes(
			operation
		)
	)
		throw new Error(`Unknown database operation: ${operation}.`);
	const source = { ...process.env, ...(env ?? {}) };
	if (source.DB_CONNECTION?.toLowerCase() !== 'pgsql')
		throw new Error('Set DB_CONNECTION=pgsql in .env.');
	const missing = ['DB_HOST', 'DB_PORT', 'DB_DATABASE', 'DB_USERNAME'].filter(
		(key) => !source[key]
	);
	if (missing.length)
		throw new Error(`Set ${missing.join(', ')} in .env. The old DATABASE_URL setting is ignored.`);
	const port = Number(source.DB_PORT);
	if (!Number.isInteger(port) || port < 1 || port > 65535)
		throw new Error('DB_PORT must be an integer from 1 to 65535.');
	const database = source.DB_DATABASE;
	const testIdentity = testIdentityForDatabase(database);
	const explicitlyMarkedTestRun =
		source.GITHUB_ACTIONS === 'true' &&
		source.VAPOURDB_TEST_DATABASE === '1' &&
		Boolean(testIdentity);
	if (database !== 'vapourdb' && !explicitlyMarkedTestRun && operation !== 'doctor')
		throw new Error('DB_DATABASE must be exactly vapourdb for application commands.');
	const options = {
		host: source.DB_HOST,
		port,
		database,
		user: source.DB_USERNAME,
		password: source.DB_PASSWORD ?? '',
		connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
		query_timeout: CONNECT_TIMEOUT_MS,
		statement_timeout: CONNECT_TIMEOUT_MS,
		application_name: `vapourdb-${operation}`
	};
	const raw = connectionString(options);
	return {
		raw,
		url: new URL(raw),
		options,
		summary: {
			host: options.host,
			port: String(port),
			database,
			username: options.user
		},
		variable: 'DB_*',
		testIdentity
	};
}

export function categorizeConnectionError(error) {
	const codes = [];
	const collectCodes = (candidate, depth = 0) => {
		if (!candidate || depth > 4) return;
		if (typeof candidate.code === 'string') codes.push(candidate.code);
		collectCodes(candidate.cause, depth + 1);
		if (Array.isArray(candidate.errors))
			for (const nested of candidate.errors) collectCodes(nested, depth + 1);
	};
	collectCodes(error);
	if (codes.some((code) => ['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL'].includes(code)))
		return 'DNS lookup failed';
	if (
		codes.some((code) =>
			[
				'ECONNREFUSED',
				'ETIMEDOUT',
				'EHOSTUNREACH',
				'ENETUNREACH',
				'ECONNRESET',
				'ECONNABORTED',
				'EACCES',
				'EPERM',
				'CONNECT_TIMEOUT',
				'ERR_SOCKET_CONNECTION_TIMEOUT'
			].includes(code)
		)
	)
		return 'TCP connection failed';
	if (codes.some((code) => code === '28P01' || code === '28000'))
		return 'PostgreSQL authentication failed';
	if (codes.includes('3D000')) return 'PostgreSQL database does not exist';
	if (codes.includes('42501')) return 'PostgreSQL privileges are insufficient';
	if (codes.includes('VDB01'))
		return 'Connected database identity does not match the configured target';
	if (codes.includes('53300')) return 'PostgreSQL has no available connection slots';
	return 'PostgreSQL connection or query failed';
}

export function createDatabaseClient(connection, applicationName) {
	const options =
		typeof connection === 'string' ? pgOptionsFromUrl(connection) : connection.options;
	return new pg.Client({ ...options, application_name: applicationName });
}

function pgOptionsFromUrl(raw) {
	const url = new URL(raw);
	return {
		host: url.hostname,
		port: Number(url.port || 5432),
		database: decodeURIComponent(url.pathname.slice(1)),
		user: decodeURIComponent(url.username),
		password: decodeURIComponent(url.password),
		connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
		query_timeout: CONNECT_TIMEOUT_MS,
		statement_timeout: CONNECT_TIMEOUT_MS
	};
}

export function missingOperationPermissions(identity, operation) {
	const missing = [];
	if (operation === 'migrate') {
		if (!identity.can_use_public) missing.push('USAGE on public');
		if (!identity.can_create_public) missing.push('CREATE on public');
		if (!identity.can_create_migration_history) missing.push('USAGE and CREATE on drizzle');
	}
	if (
		['restore', 'steamWrite'].includes(operation) &&
		(!identity.can_use_public || !identity.can_write_games)
	)
		missing.push('USAGE on public and INSERT/UPDATE on public.games');
	if (operation === 'steamRead' && (!identity.can_use_public || !identity.can_read_games))
		missing.push('USAGE on public and SELECT on public.games');
	return missing;
}

export async function preflightDatabase(connection, { operation, requireLocalOwner = true } = {}) {
	const client = createDatabaseClient(connection, `vapourdb-${operation}-preflight`);
	try {
		await client.connect();
		const result = await client.query(
			`SELECT current_database() AS database, current_user AS role,
			        current_setting('server_version') AS version,
			        has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_database_objects,
			        has_schema_privilege(current_user, 'public', 'USAGE') AS can_use_public,
			        has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_public,
			        to_regnamespace('drizzle') IS NOT NULL AS drizzle_schema_exists,
			        CASE WHEN to_regnamespace('drizzle') IS NULL
			             THEN has_database_privilege(current_user, current_database(), 'CREATE')
			             ELSE has_schema_privilege(current_user, 'drizzle', 'USAGE')
			                  AND has_schema_privilege(current_user, 'drizzle', 'CREATE') END AS can_create_migration_history,
			        CASE WHEN to_regclass('public.games') IS NULL THEN true ELSE
			         (has_table_privilege(current_user, to_regclass('public.games'), 'INSERT') AND
			          has_table_privilege(current_user, to_regclass('public.games'), 'UPDATE')) END AS can_write_games,
			        CASE WHEN to_regclass('public.games') IS NULL THEN true ELSE
			         has_table_privilege(current_user, to_regclass('public.games'), 'SELECT') END AS can_read_games,
			        inet_server_addr()::text AS server_address`
		);
		const identity = result.rows[0];
		if (
			!identity ||
			identity.database !== connection.summary.database ||
			identity.role !== connection.summary.username
		)
			throw Object.assign(new Error('configured and actual database identity differ'), {
				code: 'VDB01'
			});
		if (connection.testIdentity) {
			const marker = await client
				.query(`SELECT marker FROM public.${connection.testIdentity.markerTable} WHERE id = 1`)
				.catch(() => ({ rows: [] }));
			if (marker.rows[0]?.marker !== connection.testIdentity.markerValue)
				throw Object.assign(new Error('test database safety marker is missing'), { code: '42501' });
		}
		const missing =
			operation === 'migrate' && !requireLocalOwner
				? []
				: missingOperationPermissions(identity, operation);
		if (missing.length)
			throw Object.assign(new Error(`configured login needs ${missing.join('; ')}`), {
				code: '42501'
			});
		return identity;
	} catch (error) {
		const category = categorizeConnectionError(error);
		const failure = new Error(`${category}${error?.message ? `: ${error.message}` : ''}.`);
		failure.category = category;
		failure.code = error?.code;
		throw failure;
	} finally {
		await client.end().catch(() => {});
	}
}

export function withMigrationTimeouts(raw) {
	const url = new URL(raw);
	const existing = url.searchParams.get('options');
	url.searchParams.set(
		'options',
		`${existing ? `${existing} ` : ''}-c lock_timeout=15000 -c statement_timeout=120000`
	);
	return url.toString();
}

export function dockerPortSummary(containerName = process.env.VAPOURDB_DOCKER_CONTAINER) {
	const args = ['ps', '--format', '{{.Names}}\t{{.Ports}}'];
	const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 3000, windowsHide: true });
	if (result.error || result.status !== 0) return { available: false, lines: [] };
	const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
	if (!containerName) return { available: true, lines };
	const selected = lines.filter((line) => line.split('\t', 1)[0] === containerName);
	return {
		available: true,
		lines: selected.length ? selected : [`No running container named ${containerName}.`]
	};
}
