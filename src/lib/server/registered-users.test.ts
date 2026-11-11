import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.hoisted(() => vi.fn());

vi.mock('#lib/server/db/db.js', () => ({
	getPool: () => ({ query: queryMock })
}));

import {
	getPublicUsernamePath,
	getRegisteredUsersPageCount,
	listRegisteredUsers,
	parseRegisteredUsersPage,
	REGISTERED_USERS_PAGE_SIZE
} from './registered-users.js';

describe('registered users pagination', () => {
	beforeEach(() => vi.clearAllMocks());

	it('validates page parameters as bounded positive integers', () => {
		for (const value of [null, '', '0', '-1', '1.2', 'NaN', '999999999999999999999']) {
			expect(parseRegisteredUsersPage(value)).toBe(1);
		}
		expect(parseRegisteredUsersPage('2')).toBe(2);
		expect(parseRegisteredUsersPage('2147483647')).toBe(2_147_483_647);
		expect(getRegisteredUsersPageCount(0)).toBe(1);
		expect(getRegisteredUsersPageCount(25)).toBe(1);
		expect(getRegisteredUsersPageCount(26)).toBe(2);
	});

	it('clamps an out-of-range page and issues one count plus one current-page query', async () => {
		queryMock.mockResolvedValueOnce({ rows: [{ total: '26' }] }).mockResolvedValueOnce({
			rows: [
				{
					userId: 'latest-user-id',
					name: 'Latest User',
					username: 'latest-user',
					registeredAt: new Date('2026-11-09T12:00:00.000Z'),
					reviewsSubmitted: '0'
				}
			]
		});

		const result = await listRegisteredUsers(99);
		expect(result).toEqual({
			users: [
				{
					userId: 'latest-user-id',
					name: 'Latest User',
					username: 'latest-user',
					profilePath: '/users/latest-user',
					registeredAt: '2026-11-09T12:00:00.000Z',
					registeredAtLabel: '09 Nov 2026, 12:00 UTC',
					reviewsSubmitted: 0
				}
			],
			totalUsers: 26,
			page: 2,
			pageCount: 2
		});
		expect(queryMock).toHaveBeenCalledTimes(2);
		expect(queryMock.mock.calls[0]?.[0]).toContain('COUNT(*)');
		expect(queryMock.mock.calls[1]?.[0]).toContain('ORDER BY created_at DESC, id DESC');
		expect(queryMock.mock.calls[1]?.[0]).toContain('ORDER BY page.created_at DESC, page.id DESC');
		expect(queryMock.mock.calls[1]?.[0]).toContain('public.native_reports');
		expect(queryMock.mock.calls[1]?.[0]).not.toMatch(/moderation_state\s*=/i);
		expect(queryMock.mock.calls[1]?.[0]).toMatch(/LIMIT \$1 OFFSET \$2/);
		expect(queryMock.mock.calls[1]?.[1]).toEqual([REGISTERED_USERS_PAGE_SIZE, 25]);
	});

	it('returns only public summary fields and safely handles usernames that are not public slugs', async () => {
		queryMock.mockResolvedValueOnce({ rows: [{ total: '1' }] }).mockResolvedValueOnce({
			rows: [
				{
					userId: 'new-user-id',
					name: 'New User',
					username: '../hidden',
					registeredAt: '2026-11-09T12:00:00.000Z',
					reviewsSubmitted: '4'
				}
			]
		});
		const result = await listRegisteredUsers(1);
		expect(result.users[0]).toEqual({
			userId: 'new-user-id',
			name: 'New User',
			username: '../hidden',
			profilePath: null,
			registeredAt: '2026-11-09T12:00:00.000Z',
			registeredAtLabel: '09 Nov 2026, 12:00 UTC',
			reviewsSubmitted: 4
		});
		expect(JSON.stringify(result)).not.toMatch(/email|token|steam|ipAddress|content/i);
	});

	it('links only usernames accepted by the public profile route', () => {
		expect(getPublicUsernamePath('valid_user-2')).toBe('/users/valid_user-2');
		expect(getPublicUsernamePath('UPPER')).toBeNull();
		expect(getPublicUsernamePath('ab')).toBeNull();
		expect(getPublicUsernamePath('../private')).toBeNull();
	});
});
