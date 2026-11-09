import { beforeEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({
	isOwnerAdmin: vi.fn(),
	listRegisteredUsers: vi.fn(),
	parseRegisteredUsersPage: vi.fn((value: string | null) => (value === '2' ? 2 : 1))
}));

vi.mock('#lib/server/admin-access.js', () => ({
	isOwnerAdmin: dependencies.isOwnerAdmin
}));

vi.mock('#lib/server/registered-users.js', () => ({
	listRegisteredUsers: dependencies.listRegisteredUsers,
	parseRegisteredUsersPage: dependencies.parseRegisteredUsersPage
}));

import { load } from './+page.server.js';

function makeEvent(url = 'https://vapourdb.test/settings/users') {
	const responseHeaders: Record<string, string> = {};
	return {
		locals: {
			user: { id: 'session-user' },
			session: { id: 'active-session' }
		},
		url: new URL(url),
		setHeaders(headers: Record<string, string>) {
			Object.assign(responseHeaders, headers);
		},
		responseHeaders
	} as unknown as Parameters<typeof load>[0] & {
		responseHeaders: Record<string, string>;
	};
}

describe('private registered-users page loader', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		dependencies.isOwnerAdmin.mockResolvedValue(false);
		dependencies.listRegisteredUsers.mockResolvedValue({
			users: [],
			totalUsers: 0,
			page: 1,
			pageCount: 1
		});
	});

	it('redirects guests before requesting registered-user data', async () => {
		const event = makeEvent();
		(event as unknown as { locals: { user: null; session: null } }).locals = {
			user: null,
			session: null
		};
		await expect(load(event)).rejects.toMatchObject({ status: 303, location: '/login' });
		expect(dependencies.isOwnerAdmin).not.toHaveBeenCalled();
		expect(dependencies.listRegisteredUsers).not.toHaveBeenCalled();
		expect(event.responseHeaders).toEqual({
			'cache-control': 'private, no-store',
			'x-robots-tag': 'noindex, nofollow'
		});
	});

	it('returns 404 to signed-in non-admins without reading users, including data-request parameters', async () => {
		const event = makeEvent(
			'https://vapourdb.test/settings/users?page=2&steamId=76561198129252229'
		);
		await expect(load(event)).rejects.toMatchObject({ status: 404 });
		expect(dependencies.isOwnerAdmin).toHaveBeenCalledWith(event);
		expect(dependencies.listRegisteredUsers).not.toHaveBeenCalled();
	});

	it('loads the requested page only after the server authorization check succeeds', async () => {
		const event = makeEvent('https://vapourdb.test/settings/users?page=2');
		dependencies.isOwnerAdmin.mockResolvedValue(true);
		const data = {
			users: [
				{
					name: 'Public name',
					username: 'public-name',
					profilePath: '/users/public-name',
					registeredAt: '2026-11-09T12:00:00.000Z',
					registeredAtLabel: '09 Nov 2026, 12:00 UTC',
					reviewsSubmitted: 2
				}
			],
			totalUsers: 27,
			page: 2,
			pageCount: 2
		};
		dependencies.listRegisteredUsers.mockResolvedValue(data);

		await expect(load(event)).resolves.toEqual(data);
		expect(dependencies.listRegisteredUsers).toHaveBeenCalledWith(2);
		expect(event.responseHeaders).toEqual({
			'cache-control': 'private, no-store',
			'x-robots-tag': 'noindex, nofollow'
		});
		expect(JSON.stringify(data)).not.toMatch(/email|steam|token|ipAddress|report content/i);
	});

	it('fails closed with a generic 503 when authorization or page data lookups fail', async () => {
		const event = makeEvent();
		dependencies.isOwnerAdmin.mockRejectedValue(new Error('sensitive connection details'));
		await expect(load(event)).rejects.toMatchObject({ status: 503 });
		await expect(load(makeEvent())).rejects.toMatchObject({ status: 503 });
		expect(dependencies.listRegisteredUsers).not.toHaveBeenCalled();

		dependencies.isOwnerAdmin.mockResolvedValue(true);
		dependencies.listRegisteredUsers.mockRejectedValue(new Error('sensitive query details'));
		await expect(load(makeEvent())).rejects.toMatchObject({ status: 503 });
	});
});
