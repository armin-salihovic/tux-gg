import { and, eq, isNotNull, ne } from 'drizzle-orm';
import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/db.js';
import { authAccount } from '#lib/server/db/schema.js';

export function requireUser(event: RequestEvent) {
	if (!event.locals.user || !event.locals.session) {
		redirect(303, '/login');
	}
	return event.locals.user;
}

export function isSteamLinkedProvider(providerId: string | null): boolean {
	return providerId === 'steam';
}

export async function canPublishReports(userId: string): Promise<boolean> {
	const linkedAccounts = await getDb()
		.select({ providerId: authAccount.providerId })
		.from(authAccount)
		.where(
			and(
				eq(authAccount.userId, userId),
				isNotNull(authAccount.accountId),
				ne(authAccount.accountId, '')
			)
		)
		.limit(10);
	return linkedAccounts.some((account) => isSteamLinkedProvider(account.providerId));
}

export async function requireSteamLinkedPublisher(event: RequestEvent) {
	const user = requireUser(event);
	if (!(await canPublishReports(user.id))) {
		error(403, 'Link a Steam account before publishing a compatibility report.');
	}
	return user;
}
