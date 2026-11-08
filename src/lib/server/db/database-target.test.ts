import { describe, expect, it, vi } from 'vitest';
import {
	DatabaseTargetIdentityError,
	TEST_DATABASE_MARKER_TABLE,
	TEST_DATABASE_MARKER_VALUE,
	validateRuntimeDatabaseTarget,
	verifyRuntimeDatabaseIdentity
} from './database-target.js';

describe('web runtime database target guard', () => {
	it('accepts only the normal vapourdb target during ordinary operation', () => {
		expect(validateRuntimeDatabaseTarget('vapourdb', {})).toEqual({
			database: 'vapourdb',
			requiresTestMarker: false
		});
	});

	it.each(['tuxgg', 'postgres', 'unrelated', 'vapourdb_test', undefined])(
		'rejects %s without the constrained disposable CI flags',
		(database) => {
			expect(() => validateRuntimeDatabaseTarget(database, {})).toThrow(/DB_DATABASE=vapourdb/);
		}
	);

	it('rejects vapourdb_test in local and production processes even when the marker flag is set', () => {
		expect(() =>
			validateRuntimeDatabaseTarget('vapourdb_test', {
				NODE_ENV: 'development',
				VAPOURDB_TEST_DATABASE: '1'
			})
		).toThrow(/DB_DATABASE=vapourdb/);
		expect(() =>
			validateRuntimeDatabaseTarget('vapourdb_test', {
				NODE_ENV: 'production',
				VAPOURDB_TEST_DATABASE: '1'
			})
		).toThrow(/DB_DATABASE=vapourdb/);
	});

	it.each([
		{ GITHUB_ACTIONS: 'true' },
		{ VAPOURDB_TEST_DATABASE: '1' },
		{ GITHUB_ACTIONS: 'false', VAPOURDB_TEST_DATABASE: '1' }
	])('rejects an incomplete or false CI marker set: %o', (env) => {
		expect(() => validateRuntimeDatabaseTarget('vapourdb_test', env)).toThrow(
			/DB_DATABASE=vapourdb/
		);
	});

	it('accepts only the explicitly marked GitHub Actions test database, including production-mode CI', () => {
		expect(
			validateRuntimeDatabaseTarget('vapourdb_test', {
				NODE_ENV: 'production',
				GITHUB_ACTIONS: 'true',
				VAPOURDB_TEST_DATABASE: '1'
			})
		).toEqual({ database: 'vapourdb_test', requiresTestMarker: true });
	});

	it('checks the actual connected database and test safety marker', async () => {
		const query = vi
			.fn()
			.mockResolvedValueOnce({ rows: [{ database: 'vapourdb_test' }] })
			.mockResolvedValueOnce({ rows: [{ marker: TEST_DATABASE_MARKER_VALUE }] });
		const target = validateRuntimeDatabaseTarget('vapourdb_test', {
			GITHUB_ACTIONS: 'true',
			VAPOURDB_TEST_DATABASE: '1'
		});

		await expect(verifyRuntimeDatabaseIdentity(query, target)).resolves.toBeUndefined();
		expect(query).toHaveBeenNthCalledWith(1, 'SELECT current_database() AS database');
		expect(query).toHaveBeenNthCalledWith(
			2,
			`SELECT marker FROM public.${TEST_DATABASE_MARKER_TABLE} WHERE id = 1`
		);
	});

	it('fails closed when the connected identity or test marker is wrong', async () => {
		const wrongDatabase = vi.fn().mockResolvedValue({ rows: [{ database: 'tuxgg' }] });
		await expect(
			verifyRuntimeDatabaseIdentity(wrongDatabase, {
				database: 'vapourdb',
				requiresTestMarker: false
			})
		).rejects.toBeInstanceOf(DatabaseTargetIdentityError);

		const invalidMarker = vi
			.fn()
			.mockResolvedValueOnce({ rows: [{ database: 'vapourdb_test' }] })
			.mockResolvedValueOnce({ rows: [{ marker: 'not-disposable' }] });
		await expect(
			verifyRuntimeDatabaseIdentity(invalidMarker, {
				database: 'vapourdb_test',
				requiresTestMarker: true
			})
		).rejects.toBeInstanceOf(DatabaseTargetIdentityError);
	});
});
