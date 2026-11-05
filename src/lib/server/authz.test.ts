import { describe, expect, it } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import {
	canPublishReports,
	isSteamLinkedProvider,
	requireSteamLinkedPublisher,
	requireUser
} from './authz.js';

describe('report publishing authorization', () => {
	it('recognizes only a Steam account as a publishing identity', () => {
		expect(isSteamLinkedProvider('steam')).toBe(true);
		expect(isSteamLinkedProvider('github')).toBe(false);
		expect(isSteamLinkedProvider(null)).toBe(false);
	});

	it('keeps native report publishing disabled for Steam accounts', async () => {
		expect(await canPublishReports('steam-user')).toBe(false);
	});

	it('requires a session before checking any publishing identity', async () => {
		const event = { locals: { user: null, session: null } } as RequestEvent;
		expect(() => requireUser(event)).toThrow();
		await expect(requireSteamLinkedPublisher(event)).rejects.toMatchObject({
			status: 303,
			location: '/login'
		});
	});
});
