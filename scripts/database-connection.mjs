import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { loadLocalEnv } from './games-catalog.mjs';
import {
	identityForDatabase,
	isLocalHostname,
	testIdentityForDatabase
} from './database-identifiers.mjs';

export const CONNECT_TIMEOUT_MS = 5000;

export function normalizePnpmArgs(args) {
	return args[0] === '--' ? args.slice(1) : args;
}

const OPERATION_URLS = Object.freeze({
	migrate: { specialized: 'MIGRATION_DATABASE_URL', role: 'migrator' },
	restore: { specialized: 'IMPORTER_DATABASE_URL', role: 'importer' },
	steamWrite: { specialized: 'IMPORTER_DATABASE_URL', role: 'importer' },
	steamRead: { productionVariable: 'DATABASE_URL', role: 'web' }
});

export function databaseMode(env = process.env) {
	const requested = env.VAPOURDB_DATABASE_MODE?.toLowerCase();
	if (requested && !['development', 'production'].includes(requested))
		throw new Error('VAPOURDB_DATABASE_MODE must be development or production.');
	return requested ?? (env.NODE_ENV === 'production' ? 'production' : 'development');
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
		throw new Error('DATABASE_URL is not a valid PostgreSQL connection URL.');
	}
}

export function resolveDatabaseUrl(operation, env = process.env) {
	loadLocalEnv();
	const mode = databaseMode(env);
	const urlSpec = OPERATION_URLS[operation];
	if (!urlSpec) throw new Error(`Unknown database operation: ${operation}.`);
	const specialVariable = urlSpec.specialized;
	const specialized = specialVariable ? env[specialVariable] : undefined;
	let raw;
	let variable;
	let expectedRole;
	if (mode === 'production') {
		const productionVariable = urlSpec.productionVariable ?? specialVariable;
		const productionUrl = env[productionVariable];
		if (!productionUrl) throw new Error(`${productionVariable} is required in production mode.`);
		raw = productionUrl;
		variable = productionVariable;
		expectedRole = identityForDatabase(safeUrlSummary(raw).database)?.roles[urlSpec.role];
	} else if (specialized) {
		raw = specialized;
		variable = urlSpec.specialized;
		expectedRole = identityForDatabase(safeUrlSummary(raw).database)?.roles[urlSpec.role];
		console.warn(`${urlSpec.specialized} is deprecated for local development; use DATABASE_URL.`);
	} else {
		raw = env.DATABASE_URL;
		variable = 'DATABASE_URL';
		expectedRole = 'vapourdb_dev';
	}
	if (!raw) throw new Error(`${variable} is not configured.`);
	const summary = safeUrlSummary(raw);
	const url = new URL(raw);
	if (!['postgres:', 'postgresql:'].includes(url.protocol))
		throw new Error(`${variable} must use PostgreSQL.`);
	if (mode === 'development') {
		if (!isLocalHostname(summary.host))
			throw new Error('Local database writes require a loopback host in the connection URL.');
		if (summary.database !== 'vapourdb')
			throw new Error(
				'Local writes require the vapourdb database; legacy and test databases are not selected implicitly.'
			);
		if (summary.username === 'vapourdb_web')
			throw new Error(
				'vapourdb_web is a restricted production runtime role. Keep it restricted and use a dedicated vapourdb_dev database owner for local migrations.'
			);
		if (summary.username !== expectedRole)
			throw new Error(`${variable} must use ${expectedRole} for ${operation}.`);
	} else {
		const identity = identityForDatabase(summary.database);
		if (!identity)
			throw new Error(
				`${variable} must target a recognized application database in production mode.`
			);
		if (!expectedRole || summary.username !== expectedRole)
			throw new Error(
				`${variable} must use the dedicated ${urlSpec.role} role in production mode.`
			);
	}
	return { raw, url, summary, mode, variable, expectedRole };
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

export function createDatabaseClient(raw, applicationName) {
	return new pg.Client({
		connectionString: raw,
		application_name: applicationName,
		connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
		query_timeout: CONNECT_TIMEOUT_MS,
		statement_timeout: CONNECT_TIMEOUT_MS
	});
}

export async function preflightDatabase(connection, { operation, requireLocalOwner = true } = {}) {
	const client = createDatabaseClient(connection.raw, `vapourdb-${operation}-preflight`);
	try {
		await client.connect();
		const result = await client.query(
			`SELECT current_database() AS database, current_user AS role,
			        current_setting('server_version') AS version,
			        r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls,
			        d.datdba = r.oid AS owns_database,
			        has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_schema,
			        CASE WHEN to_regclass('public.games') IS NULL THEN true ELSE
			         (has_table_privilege(current_user, to_regclass('public.games'), 'INSERT') AND
			          has_table_privilege(current_user, to_regclass('public.games'), 'UPDATE')) END AS can_write_games,
			        pg_catalog.pg_has_role(current_user, 'pg_read_all_data', 'MEMBER') AS broad_read_membership,
			        pg_catalog.pg_has_role(current_user, 'pg_write_all_data', 'MEMBER') AS broad_write_membership,
			        EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = r.oid) AS has_role_membership,
			        inet_server_addr()::text AS server_address
			 FROM pg_roles r CROSS JOIN pg_database d
			 WHERE r.rolname = current_user AND d.datname = current_database()`
		);
		const identity = result.rows[0];
		if (!identity)
			throw Object.assign(new Error('role or database identity unavailable'), { code: '42501' });
		if (
			identity.database !== connection.summary.database ||
			identity.role !== connection.summary.username
		)
			throw Object.assign(new Error('configured and actual database identity differ'), {
				code: 'VDB01'
			});
		if (connection.mode === 'development') {
			if (identity.role !== connection.expectedRole)
				throw Object.assign(new Error('unexpected local development role'), { code: '42501' });
			if (
				requireLocalOwner &&
				operation === 'migrate' &&
				(!identity.can_create_schema ||
					(connection.expectedRole === 'vapourdb_dev' && !identity.owns_database))
			)
				throw Object.assign(new Error('local role does not own the database/schema'), {
					code: '42501'
				});
		}
		if (
			identity.rolsuper ||
			identity.rolcreatedb ||
			identity.rolcreaterole ||
			identity.rolreplication ||
			identity.rolbypassrls ||
			identity.broad_read_membership ||
			identity.broad_write_membership ||
			identity.has_role_membership
		)
			throw Object.assign(new Error('database role has unsafe administrator capabilities'), {
				code: '42501'
			});
		if (operation === 'migrate' && !identity.can_create_schema)
			throw Object.assign(new Error('migration role cannot create schema objects'), {
				code: '42501'
			});
		if (['restore', 'steamWrite'].includes(operation) && !identity.can_write_games)
			throw Object.assign(new Error('catalog role cannot write the games table'), {
				code: '42501'
			});
		const testIdentity = testIdentityForDatabase(identity.database);
		if (testIdentity) {
			const marker = await client
				.query(`SELECT marker FROM public.${testIdentity.markerTable} WHERE id = 1`)
				.catch(() => ({ rows: [] }));
			if (marker.rows[0]?.marker !== testIdentity.markerValue)
				throw Object.assign(new Error('test database safety marker is missing'), { code: '42501' });
		}
		return identity;
	} catch (error) {
		const category = categorizeConnectionError(error);
		const failure = new Error(`${category}.`);
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
