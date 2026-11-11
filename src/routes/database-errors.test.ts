import { beforeEach, describe, expect, it, vi } from 'vitest';

const queries = vi.hoisted(() => ({
	getHomeData: vi.fn(),
	getCatalog: vi.fn(),
	getGameById: vi.fn(),
	getPublicNativeReports: vi.fn(),
	getNativeReportFilters: vi.fn()
}));

vi.mock('#lib/server/db/queries.js', () => queries);

import { logDatabaseFailure } from '#lib/server/database-errors.js';
import { load as loadHome } from './+page.server.js';
import { load as loadCatalog } from './games/+page.server.js';
import { load as loadGame } from './games/[appId]/[slug]/+page.server.js';

const failingDatabaseError = Object.assign(new Error('query contains SQL and password=private'), {
	query: 'SELECT private credentials'
});

function makeEvent(path: string, params: Record<string, string> = {}) {
	const headers: Record<string, string> = {};
	return {
		headers,
		event: {
			url: new URL(path, 'https://vapourdb.example'),
			params,
			setHeaders: (next: Record<string, string>) => Object.assign(headers, next)
		}
	};
}

describe('database-backed page failures', () => {
	const logger = vi.spyOn(console, 'error').mockImplementation(() => {});

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('logs homepage failures safely and returns an uncached temporary state', async () => {
		queries.getHomeData.mockRejectedValue(failingDatabaseError);
		const { headers, event } = makeEvent('/');
		const data = (await loadHome(event as never)) as unknown as { available: boolean };

		expect(data.available).toBe(false);
		expect(headers['cache-control']).toBe('private, no-store');
		expect(logger).toHaveBeenCalledWith('[database] homepage data query failed');
		expect(JSON.stringify(logger.mock.calls)).not.toContain('private');
	});

	it('logs catalog failures and marks the temporary catalog response no-store', async () => {
		queries.getCatalog.mockRejectedValue(failingDatabaseError);
		const { headers, event } = makeEvent('/games');
		const data = (await loadCatalog(event as never)) as unknown as { available: boolean };

		expect(data.available).toBe(false);
		expect(headers['cache-control']).toBe('private, no-store');
		expect(logger).toHaveBeenCalledWith('[database] game catalog query failed');
	});

	it('reports detail query failures without treating them as missing games', async () => {
		queries.getGameById.mockResolvedValue({
			appId: '440',
			title: 'Team Fortress 2',
			slug: 'team-fortress-2',
			titleAvailable: true,
			reportCount: 12
		});
		queries.getPublicNativeReports.mockRejectedValue(failingDatabaseError);
		queries.getNativeReportFilters.mockResolvedValue({
			gpuVendors: [],
			distributions: [],
			proton: []
		});
		const { headers, event } = makeEvent('/games/440/team-fortress-2', {
			appId: '440',
			slug: 'team-fortress-2'
		});
		const data = (await loadGame(event as never)) as unknown as {
			available: boolean;
			game?: { title: string };
			nativeReportData: null;
		};

		expect(data.available).toBe(true);
		expect(data.game?.title).toBe('Team Fortress 2');
		expect(data.nativeReportData).toBeNull();
		expect(headers['cache-control']).toBe('private, no-store');
		expect(logger).toHaveBeenCalledWith('[database] native community report queries failed');
		expect(JSON.stringify(data)).not.toContain('password=private');
	});

	it('logs game lookup failures and returns an uncached temporary error state', async () => {
		queries.getGameById.mockRejectedValue(failingDatabaseError);
		const { headers, event } = makeEvent('/games/999/unknown-game', {
			appId: '999',
			slug: 'unknown-game'
		});
		const data = (await loadGame(event as never)) as unknown as { available: boolean };

		expect(data.available).toBe(false);
		expect(headers['cache-control']).toBe('private, no-store');
		expect(logger).toHaveBeenCalledWith('[database] game detail query failed');
	});

	it('logs only the PostgreSQL code for a native report insert failure', () => {
		logDatabaseFailure(
			'native report submission',
			Object.assign(new Error('query contains private report text'), {
				code: '42501',
				query: 'INSERT INTO native_reports ...',
				parameters: ['private report text']
			})
		);

		expect(logger).toHaveBeenCalledWith(
			'[database] native report submission failed (PostgreSQL 42501)'
		);
		expect(JSON.stringify(logger.mock.calls)).not.toContain('private report text');
		expect(JSON.stringify(logger.mock.calls)).not.toContain('INSERT INTO');
	});
});
