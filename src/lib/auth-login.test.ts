import { describe, expect, it, vi } from 'vitest';
import { startSteamLogin, STEAM_LOGIN_MESSAGES } from './auth-login.js';

const authorizationURL = new URL('https://steamcommunity.com/openid/login');
authorizationURL.search = new URLSearchParams({
	'openid.mode': 'checkid_setup',
	'openid.realm': 'http://localhost:5174/',
	'openid.return_to': 'http://localhost:5174/api/auth/steam/callback?flow=flow&state=state'
}).toString();

describe('Steam login initiation client', () => {
	it('returns a validated official Steam authorization URL', async () => {
		const fetcher = vi.fn(async () => Response.json({ url: authorizationURL.toString() }));

		await expect(startSteamLogin(fetcher)).resolves.toEqual({ url: authorizationURL.toString() });
		expect(fetcher).toHaveBeenCalledWith('/api/auth/steam/login', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}'
		});
	});

	it('handles non-JSON error responses without masking them as network failures', async () => {
		const result = await startSteamLogin(
			async () => new Response('<html>failure</html>', { status: 500 })
		);

		expect(result).toEqual({ error: STEAM_LOGIN_MESSAGES.unavailable });
	});

	it.each([
		[403, STEAM_LOGIN_MESSAGES.rejected],
		[500, STEAM_LOGIN_MESSAGES.unavailable],
		[503, STEAM_LOGIN_MESSAGES.unavailable]
	])('maps HTTP %s to a safe actionable message', async (status, message) => {
		const result = await startSteamLogin(async () =>
			Response.json({ error: 'internal details' }, { status })
		);

		expect(result).toEqual({ error: message });
	});

	it('explains when authentication is not configured', async () => {
		const result = await startSteamLogin(async () =>
			Response.json({ error: 'auth_not_configured' }, { status: 503 })
		);

		expect(result).toEqual({ error: STEAM_LOGIN_MESSAGES.notConfigured });
	});

	it('reports network failures separately from server responses', async () => {
		const result = await startSteamLogin(async () => {
			throw new TypeError('Failed to fetch');
		});

		expect(result).toEqual({ error: STEAM_LOGIN_MESSAGES.network });
	});

	it('rejects responses that do not point to the Steam OpenID endpoint', async () => {
		const result = await startSteamLogin(async () =>
			Response.json({ url: 'https://attacker.example/openid/login' })
		);

		expect(result).toEqual({ error: STEAM_LOGIN_MESSAGES.unavailable });
	});
});
