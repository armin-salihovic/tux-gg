import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
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

export async function canSubmitReports(userId: string): Promise<boolean> {
	const [steamAccount] = await getDb()
		.select({ id: authAccount.id })
		.from(authAccount)
		.where(and(eq(authAccount.userId, userId), eq(authAccount.providerId, 'steam')))
		.limit(1);
	return Boolean(steamAccount);
}

/** Submission and publication are separate capabilities; no public route grants publication. */
export async function canPublishReports(_userId: string): Promise<boolean> {
	return false;
}

export async function requireSteamLinkedSubmitter(event: RequestEvent) {
	const user = requireUser(event);
	if (!(await canSubmitReports(user.id))) {
		error(403, 'A Steam-linked account is required to submit reports.');
	}
	return user;
}

export async function requireSteamLinkedPublisher(event: RequestEvent) {
	const user = requireUser(event);
	if (!(await canPublishReports(user.id)))
		error(403, 'Report publication is restricted to moderators.');
	return user;
}
