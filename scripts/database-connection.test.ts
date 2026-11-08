import { describe, expect, it } from 'vitest';
import { categorizeConnectionError, safeUrlSummary } from './database-connection.mjs';

describe('shared database connection handling', () => {
	it('summarizes only host, port, database, and username', () => {
		const summary = safeUrlSummary(
			'postgresql://vapourdb_dev:must-not-appear@127.0.0.1:5544/vapourdb?sslmode=disable'
		);
		expect(summary).toEqual({
			host: '127.0.0.1',
			port: '5544',
			database: 'vapourdb',
			username: 'vapourdb_dev'
		});
		expect(JSON.stringify(summary)).not.toContain('must-not-appear');
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
