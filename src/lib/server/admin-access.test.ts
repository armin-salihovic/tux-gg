import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbResult = vi.hoisted(() => ({ accounts: [] as Array<{ accountId: string }> }));
const query = vi.hoisted(() => ({ select: vi.fn(), from: vi.fn(), where: vi.fn() }));

vi.mock('#lib/server/db/db.js', () => ({
	getDb: () => ({
		select: query.select.mockReturnValue({
			from: query.from.mockReturnValue({
				where: query.where.mockImplementation(async () => dbResult.accounts)
			})
		})
	})
}));

import { ADMIN_STEAM_IDS, isAllowlistedSteamId, isOwnerAdmin } from './admin-access.js';

describe('private registered-users authorization', () => {
	beforeEach(() => {
		dbResult.accounts = [];
		vi.clearAllMocks();
	});

	it('keeps an exact server-side array allowlist and recognizes a second entry when added', async () => {
		expect(Array.isArray(ADMIN_STEAM_IDS)).toBe(true);
		expect(ADMIN_STEAM_IDS).toEqual(['76561198129252229']);
		expect(isAllowlistedSteamId('76561198129252229')).toBe(true);
		expect(isAllowlistedSteamId('7656119812925222')).toBe(false);
		expect(isAllowlistedSteamId('x76561198129252229')).toBe(false);

		const secondSteamId = '76561198000000001';
		const allowlist = ADMIN_STEAM_IDS as unknown as string[];
		allowlist.push(secondSteamId);
		try {
			expect(isAllowlistedSteamId(secondSteamId)).toBe(true);
			dbResult.accounts = [{ accountId: secondSteamId }];
			await expect(
				isOwnerAdmin({
					locals: { user: { id: 'session-user' }, session: { id: 'session-1' } }
				} as never)
			).resolves.toBe(true);
		} finally {
			allowlist.pop();
		}
	});

	it('denies missing users or sessions without querying account data', async () => {
		await expect(isOwnerAdmin({ locals: { user: null, session: null } } as never)).resolves.toBe(
			false
		);
		await expect(
			isOwnerAdmin({ locals: { user: { id: 'user-1' }, session: null } } as never)
		).resolves.toBe(false);
		expect(query.select).not.toHaveBeenCalled();
	});

	it('grants access only for an exact allowlisted Steam account linked to the session user', async () => {
		dbResult.accounts = [{ accountId: '76561198129252229' }];
		await expect(
			isOwnerAdmin({
				locals: {
					user: { id: 'session-user' },
					session: { id: 'session-1' }
				}
			} as never)
		).resolves.toBe(true);

		dbResult.accounts = [{ accountId: '7656119812925222' }];
		await expect(
			isOwnerAdmin({
				locals: {
					user: { id: 'session-user' },
					session: { id: 'session-1' }
				}
			} as never)
		).resolves.toBe(false);
	});

	it('does not treat a request-supplied SteamID as an account link', async () => {
		dbResult.accounts = [{ accountId: '76561198000000000' }];
		const event = {
			locals: {
				user: { id: 'session-user' },
				session: { id: 'session-1' }
			},
			url: new URL('https://vapourdb.test/settings/users?steamId=76561198129252229')
		} as never;

		await expect(isOwnerAdmin(event)).resolves.toBe(false);
	});
});
