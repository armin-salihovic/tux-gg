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

export async function canPublishReports(userId: string): Promise<boolean> {
	const [steamIdentity] = await getDb()
		.select({ id: authAccount.id })
		.from(authAccount)
		.where(
			and(
				eq(authAccount.userId, userId),
				eq(authAccount.providerId, 'steam'),
				isNotNull(authAccount.accountId),
				ne(authAccount.accountId, '')
			)
		)
		.limit(1);
	return Boolean(steamIdentity);
}

export async function requireSteamLinkedPublisher(event: RequestEvent) {
	const user = requireUser(event);
	if (!(await canPublishReports(user.id))) {
		error(403, 'Link a Steam account before publishing a compatibility report.');
	}
	return user;
}
