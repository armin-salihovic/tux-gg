import { error, redirect, type RequestEvent } from '@sveltejs/kit';

export function requireUser(event: RequestEvent) {
	if (!event.locals.user || !event.locals.session) {
		redirect(303, '/login');
	}
	return event.locals.user;
}

export function isSteamLinkedProvider(providerId: string | null): boolean {
	return providerId === 'steam';
}

export async function canPublishReports(_userId: string): Promise<boolean> {
	// Steam login identifies a TuxGG account, but native report publishing is not enabled yet.
	return false;
}

export async function requireSteamLinkedPublisher(event: RequestEvent) {
	const user = requireUser(event);
	if (!(await canPublishReports(user.id))) {
		error(403, 'Native report publishing is currently disabled.');
	}
	return user;
}
