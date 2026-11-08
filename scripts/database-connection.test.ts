import { describe, expect, it } from 'vitest';
import {
	categorizeConnectionError,
	missingOperationPermissions,
	normalizePnpmArgs,
	resolveDatabaseUrl,
	safeUrlSummary,
	withMigrationTimeouts
} from './database-connection.mjs';

describe('shared database connection handling', () => {
	it('removes pnpm’s forwarded argument separator before CLI parsing', () => {
		expect(normalizePnpmArgs(['--', '--apply'])).toEqual(['--apply']);
		expect(normalizePnpmArgs(['games.csv'])).toEqual(['games.csv']);
	});

	it('summarizes only host, port, database, and username', () => {
		const summary = safeUrlSummary(
			'postgresql://postgres:must-not-appear@127.0.0.1:5544/vapourdb?sslmode=disable'
		);
		expect(summary).toEqual({
			host: '127.0.0.1',
			port: '5544',
			database: 'vapourdb',
			username: 'postgres'
		});
		expect(JSON.stringify(summary)).not.toContain('must-not-appear');
	});

	it('uses only DB_* fields and safely encodes special-character passwords', () => {
		const connection = resolveDatabaseUrl('migrate', {
			DB_CONNECTION: 'pgsql',
			DB_HOST: '127.0.0.1',
			DB_PORT: '5432',
			DB_DATABASE: 'vapourdb',
			DB_USERNAME: 'local user',
			DB_PASSWORD: 'pa:ss@word/?#%',
			DATABASE_URL: 'postgresql://ignored:ignored@localhost/tuxgg'
		} as NodeJS.ProcessEnv);
		expect(connection.options.password).toBe('pa:ss@word/?#%');
		expect(decodeURIComponent(connection.url.password)).toBe('pa:ss@word/?#%');
		expect(connection.summary).toEqual({
			host: '127.0.0.1',
			port: '5432',
			database: 'vapourdb',
			username: 'local user'
		});
	});

	it('sets bounded migration lock and statement timeouts', () => {
		const connection = resolveDatabaseUrl('migrate', {
			DB_CONNECTION: 'pgsql',
			DB_HOST: '127.0.0.1',
			DB_PORT: '5432',
			DB_DATABASE: 'vapourdb',
			DB_USERNAME: 'postgres',
			DB_PASSWORD: 'secret'
		} as NodeJS.ProcessEnv);
		const url = new URL(withMigrationTimeouts(connection.raw));
		expect(url.searchParams.get('options')).toContain('lock_timeout=15000');
		expect(url.searchParams.get('options')).toContain('statement_timeout=120000');
		expect(decodeURIComponent(url.password)).toBe('secret');
	});

	it('rejects legacy targets and accepts only marked disposable test targets', () => {
		const env = {
			DB_CONNECTION: 'pgsql',
			DB_HOST: '127.0.0.1',
			DB_PORT: '5432',
			DB_USERNAME: 'postgres',
			DB_PASSWORD: 'test'
		};
		expect(() =>
			resolveDatabaseUrl('migrate', { ...env, DB_DATABASE: 'tuxgg' } as NodeJS.ProcessEnv)
		).toThrow(/DB_DATABASE must be exactly vapourdb/);
		expect(() =>
			resolveDatabaseUrl('migrate', { ...env, DB_DATABASE: 'vapourdb_test' } as NodeJS.ProcessEnv)
		).toThrow(/DB_DATABASE must be exactly vapourdb/);
		expect(
			resolveDatabaseUrl('migrate', {
				...env,
				DB_DATABASE: 'vapourdb_test',
				VAPOURDB_TEST_DATABASE: '1'
			} as NodeJS.ProcessEnv).summary.database
		).toBe('vapourdb_test');
	});

	it('reports missing schema and migration tracking privileges precisely', () => {
		expect(
			missingOperationPermissions(
				{
					can_use_public: true,
					can_create_public: false,
					can_create_migration_history: false
				},
				'migrate'
			)
		).toEqual(['CREATE on public', 'USAGE and CREATE on drizzle']);
	});

	it.each([
		['ENOTFOUND', 'DNS lookup failed'],
		['ECONNREFUSED', 'TCP connection failed'],
		['ETIMEDOUT', 'TCP connection failed'],
		['EACCES', 'TCP connection failed'],
		['28P01', 'PostgreSQL authentication failed'],
		['3D000', 'PostgreSQL database does not exist'],
		['42501', 'PostgreSQL privileges are insufficient']
	])('categorizes %s without including the original error text', (code, category) => {
		expect(categorizeConnectionError({ code, message: 'password=secret' })).toBe(category);
	});
});
