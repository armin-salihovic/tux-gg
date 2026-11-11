import { beforeEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({
	getProfile: vi.fn(),
	getPublicUserReports: vi.fn()
}));

vi.mock('#lib/server/db/queries.js', () => ({
	getProfile: dependencies.getProfile,
	getPublicUserReports: dependencies.getPublicUserReports
}));

import { load } from './+page.server.js';

function makeEvent(url = 'https://vapourdb.test/users/player') {
	const responseHeaders: Record<string, string> = {};
	return {
		params: { username: 'player' },
		url: new URL(url),
		setHeaders(headers: Record<string, string>) {
			Object.assign(responseHeaders, headers);
		},
		responseHeaders
	} as unknown as Parameters<typeof load>[0] & { responseHeaders: Record<string, string> };
}

describe('public profile loader', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		dependencies.getProfile.mockResolvedValue({
			name: 'Public Player',
			username: 'player',
			image: null,
			createdAt: new Date('2024-01-01T00:00:00.000Z'),
			contributionCount: 1,
			worksCount: 1,
			doesNotWorkCount: 0
		});
		dependencies.getPublicUserReports.mockResolvedValue({
			reports: [
				{ id: 'report-id', appId: '440', gameTitle: 'Team Fortress 2', moderationState: 'pending' }
			],
			total: 1,
			page: 1,
			pageSize: 10,
			pageCount: 1
		});
	});

	it('loads only the profile and public report feed without shared caching', async () => {
		const event = makeEvent();
		const result = await load(event);
		expect(dependencies.getPublicUserReports).toHaveBeenCalledWith('player', 1);
		expect(result).toMatchObject({
			profile: { contributionCount: 1, worksCount: 1, doesNotWorkCount: 0 },
			reportData: { total: 1, reports: [{ id: 'report-id' }] },
			canonical: expect.stringMatching(/\/users\/player$/)
		});
		expect(event.responseHeaders['cache-control']).toBe('private, no-store');
		expect(JSON.stringify(result)).not.toMatch(
			/email|accessToken|refreshToken|session|ipAddress|hidden|removed/i
		);
	});

	it.each([24, 25, 32])('loads a %i-character database-valid username', async (length) => {
		const username = `a${'b'.repeat(length - 1)}`;
		const event = makeEvent(`https://vapourdb.test/users/${username}`);
		(event as unknown as { params: { username: string } }).params.username = username;
		dependencies.getProfile.mockResolvedValueOnce({
			name: 'Long Username Player',
			username,
			image: null,
			createdAt: new Date('2024-01-01T00:00:00.000Z'),
			contributionCount: 1,
			worksCount: 1,
			doesNotWorkCount: 0
		});

		await load(event);

		expect(dependencies.getProfile).toHaveBeenCalledWith(username);
		expect(dependencies.getPublicUserReports).toHaveBeenCalledWith(username, 1);
	});

	it('normalizes malformed and oversized page parameters before querying', async () => {
		await load(makeEvent('https://vapourdb.test/users/player?page=-3'));
		await load(makeEvent('https://vapourdb.test/users/player?page=10001'));
		expect(dependencies.getPublicUserReports).toHaveBeenNthCalledWith(1, 'player', 1);
		expect(dependencies.getPublicUserReports).toHaveBeenNthCalledWith(2, 'player', 1);
	});

	it('returns a friendly not-found response and avoids data lookup for invalid usernames', async () => {
		for (const username of [`a${'b'.repeat(32)}`, '../private', 'Abc', 'ab', '_abc']) {
			const event = makeEvent();
			(event as unknown as { params: { username: string } }).params.username = username;
			await expect(load(event)).rejects.toMatchObject({ status: 404 });
		}
		expect(dependencies.getProfile).not.toHaveBeenCalled();
	});

	it('maps profile and report query failures to generic responses', async () => {
		dependencies.getProfile.mockRejectedValueOnce(new Error('private DB details'));
		await expect(load(makeEvent())).rejects.toMatchObject({ status: 503 });
		dependencies.getPublicUserReports.mockRejectedValueOnce(new Error('private query details'));
		await expect(load(makeEvent())).rejects.toMatchObject({ status: 503 });
	});
});
