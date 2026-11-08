import { describe, expect, it } from 'vitest';
import { DATABASE_IDENTITIES } from './database-identifiers.mjs';
import { parseInitializationArgs, requireDatabaseRoleUrl } from './database-safety.mjs';

describe('database identity and destructive operation guards', () => {
	it('supports old and new application database roles during cutover', () => {
		expect(
			requireDatabaseRoleUrl(
				'postgresql://tuxgg_migrator:placeholder@localhost:5432/tuxgg',
				'MIGRATION_DATABASE_URL',
				'tuxgg_migrator'
			).database
		).toBe('tuxgg');
		expect(
			requireDatabaseRoleUrl(
				'postgresql://vapourdb_migrator:placeholder@localhost:5432/vapourdb',
				'MIGRATION_DATABASE_URL',
				'vapourdb_migrator'
			).database
		).toBe('vapourdb');
	});

	it('rejects a test database as an application database and checks the exact role', () => {
		expect(() =>
			requireDatabaseRoleUrl(
				`postgresql://vapourdb_migrator:placeholder@localhost:5432/${DATABASE_IDENTITIES.vapourdb.test}`,
				'MIGRATION_DATABASE_URL',
				'vapourdb_migrator'
			)
		).toThrow(/must not target a disposable test database/);
		expect(() =>
			requireDatabaseRoleUrl(
				'postgresql://vapourdb_web:placeholder@localhost:5432/vapourdb',
				'MIGRATION_DATABASE_URL',
				'vapourdb_migrator'
			)
		).toThrow(/must use the vapourdb_migrator role/);
	});

	it('allows only explicitly named empty initialization and refuses force reset', () => {
		expect(parseInitializationArgs(['--initialize-empty'])).toEqual({
			initializeEmpty: true,
			games: null
		});
		expect(() => parseInitializationArgs(['--force'])).toThrow(/never reset/);
		expect(() => parseInitializationArgs([])).toThrow(/--initialize-empty/);
	});

	it('requires a test role and an explicitly test-named database before fixtures can write', () => {
		expect(
			requireDatabaseRoleUrl(
				`postgresql://vapourdb_importer:placeholder@localhost:5432/${DATABASE_IDENTITIES.vapourdb.test}`,
				'IMPORTER_DATABASE_URL',
				'vapourdb_importer',
				true
			).database
		).toBe(DATABASE_IDENTITIES.vapourdb.test);
		expect(() =>
			requireDatabaseRoleUrl(
				'postgresql://tuxgg_importer:placeholder@localhost:5432/tuxgg',
				'IMPORTER_DATABASE_URL',
				'tuxgg_importer',
				true
			)
		).toThrow(/must target a disposable test database/);
		expect(
			requireDatabaseRoleUrl(
				'postgresql://tuxgg_importer:placeholder@localhost:5432/tuxgg_test',
				'IMPORTER_DATABASE_URL',
				'tuxgg_importer',
				true
			).database
		).toBe('tuxgg_test');
	});

	it('allows the PostgreSQL admin URL only for the named disposable test database', () => {
		expect(
			requireDatabaseRoleUrl(
				'postgresql://postgres:placeholder@localhost:5432/vapourdb_test',
				'TEST_DATABASE_URL',
				'postgres',
				true
			).database
		).toBe('vapourdb_test');
		expect(() =>
			requireDatabaseRoleUrl(
				'postgresql://postgres:placeholder@localhost:5432/vapourdb',
				'TEST_DATABASE_URL',
				'postgres',
				true
			)
		).toThrow(/must target a disposable test database/);
	});
});
