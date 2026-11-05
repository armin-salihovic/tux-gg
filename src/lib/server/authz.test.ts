import { describe, expect, it } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { isSteamLinkedProvider, requireSteamLinkedPublisher, requireUser } from './authz.js';

describe('report publishing authorization', () => {
	it('recognizes only a Steam account as a publishing identity', () => {
		expect(isSteamLinkedProvider('steam')).toBe(true);
		expect(isSteamLinkedProvider('github')).toBe(false);
		expect(isSteamLinkedProvider(null)).toBe(false);
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
