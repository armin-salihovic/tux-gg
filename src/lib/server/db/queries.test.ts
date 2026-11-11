import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.hoisted(() => vi.fn());

vi.mock('#lib/server/db/db.js', () => ({
	getPool: () => ({ query: queryMock }),
	getDb: vi.fn()
}));

import { getPublicUserReports } from './queries.js';

describe('public user report query', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns ten public reports per page and clamps out-of-range pages', async () => {
		queryMock
			.mockResolvedValueOnce({ rows: [{ total: 21 }] })
			.mockResolvedValueOnce({ rows: [{ id: 'last-report' }] });
		const result = await getPublicUserReports('player', 100);
		expect(result).toEqual({
			reports: [{ id: 'last-report' }],
			total: 21,
			page: 3,
			pageSize: 10,
			pageCount: 3
		});
		expect(queryMock).toHaveBeenCalledTimes(2);
		const [countSql, countValues] = queryMock.mock.calls[0] as [string, unknown[]];
		expect(countSql).toContain("moderation_state IN ('pending', 'published')");
		expect(countValues).toEqual(['player']);
		const [reportSql, reportValues] = queryMock.mock.calls[1] as [string, unknown[]];
		expect(reportSql).toContain("moderation_state IN ('pending', 'published')");
		expect(reportSql).toContain('ORDER BY report.created_at DESC, report.id DESC');
		expect(reportSql).toContain('LIMIT $2 OFFSET $3');
		expect(reportSql).not.toMatch(
			/email|access_token|refresh_token|session|ip_address|moderation_state AS/i
		);
		expect(reportValues).toEqual(['player', 10, 20]);
	});

	it('binds usernames and safely returns an empty profile page', async () => {
		queryMock.mockResolvedValueOnce({ rows: [{ total: '0' }] }).mockResolvedValueOnce({ rows: [] });
		const result = await getPublicUserReports("name' OR TRUE --", 1);
		expect(result).toMatchObject({ reports: [], total: 0, page: 1, pageCount: 1 });
		expect(queryMock.mock.calls[1]?.[0]).not.toContain("name' OR TRUE --");
		expect(queryMock.mock.calls[1]?.[1]).toEqual(["name' OR TRUE --", 10, 0]);
	});
});
