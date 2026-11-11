import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.hoisted(() => vi.fn());

vi.mock('#lib/server/db/db.js', () => ({
	getPool: () => ({ query: queryMock })
}));

import {
	listReportsForModeration,
	moderateNativeReport,
	parseReportModerationFilter,
	parseReportModerationPage,
	REPORT_MODERATION_PAGE_SIZE
} from './report-moderation.js';

describe('report moderation queries', () => {
	beforeEach(() => vi.clearAllMocks());

	it('parses moderation filters and bounded pages safely', () => {
		for (const value of [null, '', '0', '-1', '1.5', 'abc', '99999999999999999']) {
			expect(parseReportModerationPage(value)).toBe(1);
		}
		expect(parseReportModerationPage('25')).toBe(25);
		expect(parseReportModerationFilter('removed')).toBe('removed');
		expect(parseReportModerationFilter('all')).toBe('all');
		expect(parseReportModerationFilter('pending-ish')).toBe('pending');
	});

	it('filters pending reports with bound search and account values, oldest first, and clamps pages', async () => {
		queryMock
			.mockResolvedValueOnce({ rows: [{ total: '30' }] })
			.mockResolvedValueOnce({ rows: [{ id: 'oldest-report' }] })
			.mockResolvedValueOnce({ rows: [{ moderationState: 'pending', total: '30' }] });

		const result = await listReportsForModeration({
			filter: 'pending',
			search: "player' OR true --",
			userId: 'stable-user-id',
			page: 9
		});

		expect(result).toMatchObject({
			total: 30,
			page: 2,
			pageCount: 2,
			pageSize: REPORT_MODERATION_PAGE_SIZE
		});
		expect(queryMock).toHaveBeenCalledTimes(3);
		const [countSql, countValues] = queryMock.mock.calls[0] as [string, unknown[]];
		expect(countSql).toContain('report.moderation_state = $1');
		expect(countSql).toContain('report.author_id = $2');
		expect(countSql).toContain('author.username ILIKE $3');
		expect(countSql).not.toContain("player' OR true");
		expect(countValues).toEqual(['pending', 'stable-user-id', "%player' OR true --%"]);
		const [reportsSql, reportsValues] = queryMock.mock.calls[1] as [string, unknown[]];
		expect(reportsSql).toContain('ORDER BY report.created_at ASC, report.id ASC');
		expect(reportsSql).toContain('LIMIT $4 OFFSET $5');
		expect(reportsValues).toEqual(['pending', 'stable-user-id', "%player' OR true --%", 25, 25]);
	});

	it('orders other moderation views newest first and searches Steam AppIDs through parameters', async () => {
		queryMock
			.mockResolvedValueOnce({ rows: [{ total: 1 }] })
			.mockResolvedValueOnce({ rows: [] })
			.mockResolvedValueOnce({ rows: [] });
		await listReportsForModeration({ filter: 'all', search: '730', page: 1 });
		const [sql, values] = queryMock.mock.calls[1] as [string, unknown[]];
		expect(sql).toContain('report.app_id ILIKE $1');
		expect(sql).toContain('ORDER BY report.created_at DESC, report.id DESC');
		expect(values).toEqual(['%730%', 25, 0]);
	});

	it('uses a guarded update, changes only moderation timestamps, and reports a stale submission', async () => {
		queryMock
			.mockResolvedValueOnce({ rowCount: 0 })
			.mockResolvedValueOnce({ rows: [{ moderationState: 'published' }] });
		expect(
			await moderateNativeReport('11111111-1111-4111-8111-111111111111', 'pending', 'review')
		).toBe('stale');
		const [sql, values] = queryMock.mock.calls[0] as [string, unknown[]];
		expect(sql).toContain('WHERE id = $1::uuid AND moderation_state = $2');
		expect(sql).toContain('updated_at = now()');
		expect(sql).not.toMatch(/SET[^;]*created_at/i);
		expect(values).toEqual(['11111111-1111-4111-8111-111111111111', 'pending', 'published']);
	});

	it('rejects an invalid transition without querying and distinguishes missing reports', async () => {
		expect(await moderateNativeReport('id', 'removed', 'hide')).toBe('invalid');
		expect(queryMock).not.toHaveBeenCalled();
		expect(await moderateNativeReport('malformed-uuid', 'pending', 'review')).toBe('invalid');
		expect(queryMock).not.toHaveBeenCalled();
		queryMock.mockResolvedValueOnce({ rowCount: 0 }).mockResolvedValueOnce({ rows: [] });
		expect(
			await moderateNativeReport('11111111-1111-4111-8111-111111111111', 'hidden', 'restore')
		).toBe('missing');
	});

	it.each([
		['pending', 'review', 'published'],
		['pending', 'hide', 'hidden'],
		['published', 'hide', 'hidden'],
		['pending', 'remove', 'removed'],
		['published', 'remove', 'removed'],
		['hidden', 'remove', 'removed'],
		['hidden', 'restore', 'published'],
		['removed', 'restore', 'published']
	] as const)('allows %s → %s to persist %s with one guarded update', async (from, action, to) => {
		queryMock.mockResolvedValueOnce({ rowCount: 1 });
		expect(await moderateNativeReport('11111111-1111-4111-8111-111111111111', from, action)).toBe(
			'updated'
		);
		expect(queryMock).toHaveBeenCalledTimes(1);
		expect(queryMock.mock.calls[0]?.[1]).toEqual([
			'11111111-1111-4111-8111-111111111111',
			from,
			to
		]);
	});
});
