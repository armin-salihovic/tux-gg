import { describe, expect, it, vi } from 'vitest';
import {
	buildSteamOpenIDUrl,
	fetchSteamProfile,
	STEAM_OPENID_NAMESPACE,
	STEAM_OPENID_URL,
	verifySteamOpenIDResponse
} from './steam-openid.js';

const steamId = '76561198012345678';
const returnTo = 'https://vapourdb.example/api/auth/steam/callback?flow=abc&state=xyz';

function responseNonce(ageMs = 0) {
	return `${new Date(Date.now() - ageMs).toISOString().replace(/\.\d{3}Z$/, 'Z')}testnonce`;
}

function assertion(overrides: Record<string, string> = {}) {
	const fields: Record<string, string> = {
		'openid.ns': STEAM_OPENID_NAMESPACE,
		'openid.mode': 'id_res',
		'openid.op_endpoint': STEAM_OPENID_URL,
		'openid.claimed_id': `https://steamcommunity.com/openid/id/${steamId}`,
		'openid.identity': `https://steamcommunity.com/openid/id/${steamId}`,
		'openid.return_to': returnTo,
		'openid.response_nonce': responseNonce(),
		'openid.assoc_handle': 'test-association',
		'openid.signed': 'op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
		'openid.sig': 'c2ln'
	};
	return new URLSearchParams({ ...fields, ...overrides });
}

function validSteamResponse() {
	return new Response(`ns:${STEAM_OPENID_NAMESPACE}\nis_valid:true\n`, { status: 200 });
}

describe('Steam OpenID', () => {
	it('builds a Steam OpenID 2.0 request with the configured realm and return URL', () => {
		const url = new URL(buildSteamOpenIDUrl('https://vapourdb.example/', returnTo));
		expect(url.origin).toBe('https://steamcommunity.com');
		expect(url.pathname).toBe('/openid/login');
		expect(url.searchParams.get('openid.ns')).toBe(STEAM_OPENID_NAMESPACE);
		expect(url.searchParams.get('openid.mode')).toBe('checkid_setup');
		expect(url.searchParams.get('openid.realm')).toBe('https://vapourdb.example/');
		expect(url.searchParams.get('openid.return_to')).toBe(returnTo);
	});

	it('accepts a valid assertion only after Steam confirms its signature', async () => {
		const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
			validSteamResponse()
		);
		const verified = await verifySteamOpenIDResponse(assertion(), returnTo, fetcher);
		expect(verified.steamId).toBe(steamId);
		expect(verified.responseNonce).toContain('testnonce');
		expect(fetcher).toHaveBeenCalledOnce();
		const [endpoint, request] = fetcher.mock.calls[0]!;
		expect(endpoint).toBe(STEAM_OPENID_URL);
		expect(request?.method).toBe('POST');
		expect(request?.redirect).toBe('manual');
		expect(new URLSearchParams(String(request?.body)).get('openid.mode')).toBe(
			'check_authentication'
		);
	});

	it.each([
		['wrong namespace', { 'openid.ns': 'http://attacker.invalid/openid' }],
		['negative assertion', { 'openid.mode': 'cancel' }],
		['forged provider', { 'openid.op_endpoint': 'https://attacker.invalid/openid' }],
		['incorrect callback URL', { 'openid.return_to': 'https://attacker.invalid/callback' }],
		['forged Steam ID', { 'openid.claimed_id': 'https://steamcommunity.com/openid/id/12345' }],
		[
			'mismatched identity',
			{ 'openid.identity': 'https://steamcommunity.com/openid/id/76561198099999999' }
		],
		['expired OpenID nonce', { 'openid.response_nonce': responseNonce(11 * 60 * 1000) }],
		[
			'missing signed return URL',
			{ 'openid.signed': 'op_endpoint,claimed_id,identity,response_nonce,assoc_handle' }
		]
	])('rejects %s before asking Steam to verify', async (_name, overrides) => {
		const fetcher = vi.fn(async () => validSteamResponse());
		await expect(
			verifySteamOpenIDResponse(assertion(overrides), returnTo, fetcher)
		).rejects.toThrow();
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('rejects duplicate fields and Steam responses that do not validate the signature', async () => {
		const duplicated = assertion();
		duplicated.append('openid.claimed_id', `https://steamcommunity.com/openid/id/${steamId}`);
		await expect(
			verifySteamOpenIDResponse(
				duplicated,
				returnTo,
				vi.fn(async () => validSteamResponse())
			)
		).rejects.toThrow(/duplicate/i);
		await expect(
			verifySteamOpenIDResponse(
				assertion(),
				returnTo,
				vi.fn(async () => new Response(`ns:${STEAM_OPENID_NAMESPACE}\nis_valid:false\n`))
			)
		).rejects.toThrow(/rejected/i);
	});

	it('fails closed when Steam is unavailable', async () => {
		await expect(
			verifySteamOpenIDResponse(
				assertion(),
				returnTo,
				vi.fn(async () => new Response('unavailable', { status: 503 }))
			)
		).rejects.toThrow(/unavailable/i);
	});
});

describe('Steam profile enrichment', () => {
	it('skips the profile API when no key is configured', async () => {
		const fetcher = vi.fn();
		await expect(fetchSteamProfile(steamId, undefined, fetcher)).resolves.toBeNull();
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('returns matching optional Steam profile details and rejects mismatched IDs', async () => {
		const profile = {
			steamid: steamId,
			personaname: 'Player One',
			avatarfull: 'https://avatars.steamstatic.com/avatar_full.jpg',
			profileurl: 'https://steamcommunity.com/profiles/76561198012345678/'
		};
		const fetcher = vi.fn(async () => Response.json({ response: { players: [profile] } }));
		await expect(fetchSteamProfile(steamId, 'test-key', fetcher)).resolves.toEqual({
			name: 'Player One',
			image: profile.avatarfull,
			profileUrl: profile.profileurl
		});
		const mismatched = vi.fn(async () =>
			Response.json({ response: { players: [{ ...profile, steamid: '76561198087654321' }] } })
		);
		await expect(fetchSteamProfile(steamId, 'test-key', mismatched)).resolves.toBeNull();
	});

	it('uses a safe SteamID64 profile URL and ignores untrusted avatar URLs', async () => {
		const fetcher = vi.fn(async () =>
			Response.json({
				response: {
					players: [
						{
							steamid: steamId,
							personaname: 'Player Two',
							avatarfull: 'https://attacker.invalid/avatar.jpg',
							profileurl: 'javascript:alert(1)'
						}
					]
				}
			})
		);
		await expect(fetchSteamProfile(steamId, 'test-key', fetcher)).resolves.toEqual({
			name: 'Player Two',
			profileUrl: `https://steamcommunity.com/profiles/${steamId}/`
		});
	});

	it('allows the sign-in flow to handle API failures independently', async () => {
		await expect(
			fetchSteamProfile(
				steamId,
				'test-key',
				vi.fn(async () => new Response('', { status: 503 }))
			)
		).rejects.toThrow(/profile lookup failed/i);
	});
});
