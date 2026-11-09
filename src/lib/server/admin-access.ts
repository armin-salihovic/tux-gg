import type { RequestEvent } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { getDb } from '#lib/server/db/db.js';
import { authAccount } from '#lib/server/db/schema.js';

/** Steam identities allowed to view the private registered-users overview. */
export const ADMIN_STEAM_IDS = ['76561198129252229'] as const;

export function isAllowlistedSteamId(accountId: string): boolean {
	return ADMIN_STEAM_IDS.some((adminSteamId) => adminSteamId === accountId);
}

/** Check the signed-in Better Auth user against their persisted Steam account link. */
export async function isOwnerAdmin(event: Pick<RequestEvent, 'locals'>): Promise<boolean> {
	const { user, session } = event.locals;
	if (!user || !session) return false;

	const accounts = await getDb()
		.select({ accountId: authAccount.accountId })
		.from(authAccount)
		.where(and(eq(authAccount.userId, user.id), eq(authAccount.providerId, 'steam')));

	return accounts.some(({ accountId }) => isAllowlistedSteamId(accountId));
}
