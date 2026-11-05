import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import { getAuth } from '#lib/server/auth.js';
import { canPublishReports } from '#lib/server/authz.js';
import { closeDatabase, getDb, getPool } from '#lib/server/db/db.js';
import { authAccount, authSession, authUser, authVerification } from '#lib/server/db/schema.js';
import { getProfile } from '#lib/server/db/queries.js';
import { STEAM_OPENID_NAMESPACE, STEAM_OPENID_URL } from './steam-openid.js';

const enabled = process.env.AUTH_INTEGRATION_TESTS === '1';
const databaseUrl = process.env.DATABASE_URL;
const baseURL = process.env.BETTER_AUTH_URL ?? 'https://localhost:5173';
const runId = `tuxgg-steam-test-${Date.now()}`;
const steamIdBlock = Math.floor(Math.random() * 10_000);
const steamIds = [0, 1, 2, 3].map(
	(offset) => `7656119${String((steamIdBlock + offset) % 10_000).padStart(4, '0')}000001`
);
let nonceSequence = 0;
const validAssertions = new Map<string, Record<string, string>>();
const originalFetch = globalThis.fetch;
let rejectNextVerification = false;
let steamUnavailable = false;
let auth: ReturnType<typeof getAuth>;
let databaseVerified = false;
let firstUserId: string | undefined;
let conflictUserId: string | undefined;

function setCookieHeaders(response: Response): string[] {
	return response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''];
}

function cookiePairs(response: Response): string {
	return setCookieHeaders(response)
		.map((cookie) => cookie.split(';', 1)[0]!)
		.filter((cookie) => /(?:steam_state_|session_token=)/.test(cookie))
		.join('; ');
}

function sessionCookie(response: Response): string {
	return (
		setCookieHeaders(response)
			.map((cookie) => cookie.split(';', 1)[0]!)
			.find((cookie) => cookie.includes('session_token=')) ?? ''
	);
}

async function beginLogin() {
	const response = await auth.handler(
		new Request(`${baseURL}/api/auth/steam/login`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				origin: baseURL,
				'x-forwarded-for': `192.0.2.${(nonceSequence++ % 200) + 1}`
			},
			body: '{}'
		})
	);
	expect(response.status).toBe(200);
	const body = (await response.json()) as { url: string };
	const authorizationURL = new URL(body.url);
	expect(authorizationURL.origin).toBe('https://steamcommunity.com');
	expect(authorizationURL.pathname).toBe('/openid/login');
	expect(authorizationURL.searchParams.get('openid.mode')).toBe('checkid_setup');
	const returnTo = authorizationURL.searchParams.get('openid.return_to');
	if (!returnTo) throw new Error('Steam OpenID request did not include a return URL.');
	return { response, authorizationURL, returnTo, cookies: cookiePairs(response) };
}

function makeCallback(
	flow: Awaited<ReturnType<typeof beginLogin>>,
	options: {
		steamId?: string;
		claimedId?: string;
		identity?: string;
		returnTo?: string;
		nonce?: string;
		signature?: string;
		mode?: string;
	} = {}
): URL {
	const steamId = options.steamId ?? steamIds[0]!;
	const claimedId = options.claimedId ?? `https://steamcommunity.com/openid/id/${steamId}`;
	const nonce =
		options.nonce ?? `${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}test-${++nonceSequence}`;
	const signature = options.signature ?? `c2ln${String(nonceSequence).padStart(4, '0')}`;
	const fields: Record<string, string> = {
		'openid.ns': STEAM_OPENID_NAMESPACE,
		'openid.mode': options.mode ?? 'id_res',
		'openid.op_endpoint': STEAM_OPENID_URL,
		'openid.claimed_id': claimedId,
		'openid.identity': options.identity ?? claimedId,
		'openid.return_to': options.returnTo ?? flow.returnTo,
		'openid.response_nonce': nonce,
		'openid.assoc_handle': 'mocked-steam-association',
		'openid.signed': 'op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
		'openid.sig': signature
	};
	validAssertions.set(signature, fields);
	const callback = new URL(flow.returnTo);
	for (const [key, value] of Object.entries(fields)) callback.searchParams.set(key, value);
	return callback;
}

function startAssertion(flow: Awaited<ReturnType<typeof beginLogin>>, options = {}) {
	return makeCallback(flow, options);
}

async function finishLogin(
	flow: Awaited<ReturnType<typeof beginLogin>>,
	options: {
		steamId?: string;
		claimedId?: string;
		identity?: string;
		returnTo?: string;
		nonce?: string;
		signature?: string;
		mode?: string;
	} = {},
	cookies = flow.cookies
) {
	return auth.handler(
		new Request(startAssertion(flow, options), {
			headers: cookies ? { cookie: cookies } : {}
		})
	);
}

async function getSession(cookie: string) {
	const response = await auth.handler(
		new Request(`${baseURL}/api/auth/get-session`, { headers: cookie ? { cookie } : {} })
	);
	return (await response.json()) as {
		session: { id: string; expiresAt: string } | null;
		user: Record<string, unknown> | null;
	} | null;
}

function installSteamMocks() {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			const url = new URL(
				typeof input === 'string' ? input : input instanceof Request ? input.url : input.href
			);
			if (url.hostname === 'steamcommunity.com' && url.pathname === '/openid/login') {
				if (steamUnavailable) return new Response('Steam unavailable', { status: 503 });
				if (init?.method !== 'POST') throw new Error('Steam verification must use a POST request.');
				const body = new URLSearchParams(String(init.body));
				if (body.get('openid.mode') !== 'check_authentication') {
					throw new Error('Steam verification did not use check_authentication.');
				}
				const signature = body.get('openid.sig') ?? '';
				const expected = validAssertions.get(signature);
				const signedFields = body.get('openid.signed')?.split(',') ?? [];
				const matchesSignedAssertion =
					expected !== undefined &&
					signedFields.every(
						(field) => body.get(`openid.${field}`) === expected[`openid.${field}`]
					);
				const accepted = matchesSignedAssertion && !rejectNextVerification;
				rejectNextVerification = false;
				return new Response(
					`ns:${STEAM_OPENID_NAMESPACE}\nis_valid:${accepted ? 'true' : 'false'}\n`,
					{ status: 200 }
				);
			}
			if (url.hostname === 'api.steampowered.com') {
				return Response.json({ response: { players: [] } });
			}
			throw new Error(
				`Unexpected network request in mocked Steam flow: ${url.hostname}${url.pathname}`
			);
		})
	);
}

describe.skipIf(!enabled)('Steam OpenID and Better Auth session integration', () => {
	beforeAll(async () => {
		if (!databaseUrl || new URL(databaseUrl).pathname.replace(/^\//, '') !== 'tuxgg_test') {
			throw new Error('Auth integration tests require DATABASE_URL to target tuxgg_test.');
		}
		const pool = getPool();
		const identity = await pool.query('SELECT current_database() AS database');
		if (identity.rows[0]?.database !== 'tuxgg_test') {
			throw new Error('Auth integration tests refused a database other than tuxgg_test.');
		}
		const marker = await pool.query(
			'SELECT marker FROM public.tuxgg_test_safety_marker WHERE id = 1'
		);
		if (marker.rows[0]?.marker !== 'tuxgg_disposable_test_database_v1') {
			throw new Error('Auth integration tests require the disposable database marker.');
		}
		databaseVerified = true;
		auth = getAuth();
		installSteamMocks();
	});

	afterAll(async () => {
		vi.stubGlobal('fetch', originalFetch);
		try {
			const accounts =
				enabled && databaseVerified
					? await getDb()
							.select({ userId: authAccount.userId })
							.from(authAccount)
							.where(
								and(eq(authAccount.providerId, 'steam'), inArray(authAccount.accountId, steamIds))
							)
					: [];
			const testUserIds = accounts.map((account) => account.userId);
			if (conflictUserId) testUserIds.push(conflictUserId);
			if (testUserIds.length) {
				await getDb()
					.delete(authUser)
					.where(inArray(authUser.id, [...new Set(testUserIds)]));
			}
		} finally {
			await closeDatabase();
		}
	});

	it('creates a Steam-only account, a Better Auth session, and a private unverified placeholder email', async () => {
		const flow = await beginLogin();
		const response = await finishLogin(flow, { steamId: steamIds[0] });
		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe(`${baseURL}/settings`);
		expect(process.env.NODE_ENV).toBe('production');
		const cookie = sessionCookie(response);
		expect(cookie).toMatch(/(?:tuxgg|__Secure-tuxgg)\.session_token=/);
		const sessionCookies = setCookieHeaders(response).filter((value) =>
			value.includes('session_token=')
		);
		expect(sessionCookies.join('; ')).toMatch(/HttpOnly/i);
		expect(sessionCookies.join('; ')).toMatch(/Secure/i);
		expect(sessionCookies.join('; ')).toMatch(/SameSite=Lax/i);

		const session = await getSession(cookie);
		expect(session?.user?.name).toBe(`Steam player ${steamIds[0]!.slice(-6)}`);
		expect(session?.user?.email).toBe(`steam-${steamIds[0]}@steam.invalid`);
		expect(session?.user?.emailVerified).toBe(false);
		firstUserId = String(session?.user?.id);
		expect(await canPublishReports(firstUserId)).toBe(false);
		expect(JSON.stringify(session)).not.toContain('accessToken');

		const account = await getDb()
			.select({
				providerId: authAccount.providerId,
				accountId: authAccount.accountId,
				accessToken: authAccount.accessToken,
				refreshToken: authAccount.refreshToken
			})
			.from(authAccount)
			.where(eq(authAccount.userId, firstUserId));
		expect(account).toEqual([
			{
				providerId: 'steam',
				accountId: steamIds[0],
				accessToken: null,
				refreshToken: null
			}
		]);
		const user = await getDb()
			.select({ emailVerified: authUser.emailVerified, username: authUser.username })
			.from(authUser)
			.where(eq(authUser.id, firstUserId));
		expect(user[0]?.username).toMatch(/^[a-z0-9][a-z0-9_-]{2,23}$/);
		expect(user[0]?.emailVerified).toBe(false);
		const publicProfile = await getProfile(user[0]!.username);
		expect(publicProfile).not.toHaveProperty('email');
		expect(JSON.stringify(publicProfile)).not.toContain('@steam.invalid');
	});

	it('signs returning Steam users into the same account without duplicates', async () => {
		const flow = await beginLogin();
		const response = await finishLogin(flow, { steamId: steamIds[0] });
		const session = await getSession(sessionCookie(response));
		expect(session?.user?.id).toBe(firstUserId);
		const accounts = await getDb()
			.select({ id: authAccount.id })
			.from(authAccount)
			.where(eq(authAccount.accountId, steamIds[0]!));
		expect(accounts).toHaveLength(1);
	});

	it('does not merge an existing user by the internal placeholder email', async () => {
		const steamId = steamIds[2]!;
		const email = `steam-${steamId}@steam.invalid`;
		const username = `${runId.slice(-12)}-old`;
		const [user] = await getDb()
			.insert(authUser)
			.values({ id: `${runId}-old`, name: 'Old account', email, username })
			.returning({ id: authUser.id });
		conflictUserId = user!.id;
		const flow = await beginLogin();
		const response = await finishLogin(flow, { steamId });
		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toContain('/login?error=steam_account_unavailable');
		const account = await getDb()
			.select({ id: authAccount.id })
			.from(authAccount)
			.where(eq(authAccount.accountId, steamId));
		expect(account).toHaveLength(0);
	});

	it('rejects forged identities and invalid OpenID signatures server-side', async () => {
		const flow = await beginLogin();
		const validButForgedId = '76561198999999999';
		const forged = await finishLogin(flow, {
			steamId: validButForgedId,
			claimedId: `https://steamcommunity.com/openid/id/${validButForgedId}`,
			identity: `https://steamcommunity.com/openid/id/${validButForgedId}`
		});
		expect(forged.status).toBe(302);
		expect(forged.headers.get('location')).toContain('steam_verification_failed');
		expect(sessionCookie(forged)).toBe('');

		const malformedFlow = await beginLogin();
		const malformed = await finishLogin(malformedFlow, {
			claimedId: 'https://steamcommunity.com/openid/id/not-a-steamid'
		});
		expect(malformed.status).toBe(302);
		expect(malformed.headers.get('location')).toContain('steam_verification_failed');
	});

	it('rejects an incorrect callback URL before sending the assertion to Steam', async () => {
		const flow = await beginLogin();
		const response = await finishLogin(flow, { returnTo: 'https://attacker.invalid/callback' });
		expect(response.headers.get('location')).toContain('steam_verification_failed');
	});

	it('binds each login to the browser and rejects expired or replayed state', async () => {
		const missingCookieFlow = await beginLogin();
		const noCookie = await finishLogin(missingCookieFlow, {}, '');
		expect(noCookie.headers.get('location')).toContain('steam_state_invalid');

		const expiredFlow = await beginLogin();
		const state = new URL(expiredFlow.returnTo).searchParams.get('state')!;
		await getDb()
			.update(authVerification)
			.set({ expiresAt: new Date(Date.now() - 60_000) })
			.where(eq(authVerification.identifier, `auth-state:${state}`));
		const expired = await finishLogin(expiredFlow);
		expect(expired.headers.get('location')).toContain('steam_state_invalid');

		const replayFlow = await beginLogin();
		const accepted = await finishLogin(replayFlow);
		expect(accepted.status).toBe(302);
		const replayed = await finishLogin(replayFlow);
		expect(replayed.headers.get('location')).toContain('steam_state_invalid');
		expect(sessionCookie(replayed)).toBe('');
	});

	it('prevents a Steam OpenID response nonce from being replayed across login states', async () => {
		const nonce = `${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}shared-nonce`;
		const firstFlow = await beginLogin();
		const first = await finishLogin(firstFlow, { steamId: steamIds[1], nonce });
		expect(first.status).toBe(302);
		const secondFlow = await beginLogin();
		const replay = await finishLogin(secondFlow, { steamId: steamIds[1], nonce });
		expect(replay.headers.get('location')).toContain('steam_verification_failed');
		expect(sessionCookie(replay)).toBe('');
	});

	it('handles simultaneous callbacks for one SteamID without creating duplicate users', async () => {
		const firstFlow = await beginLogin();
		const secondFlow = await beginLogin();
		const [first, second] = await Promise.all([
			finishLogin(firstFlow, { steamId: steamIds[3] }),
			finishLogin(secondFlow, { steamId: steamIds[3] })
		]);
		const firstSession = await getSession(sessionCookie(first));
		const secondSession = await getSession(sessionCookie(second));
		expect(first.status).toBe(302);
		expect(second.status).toBe(302);
		expect(firstSession?.user?.id).toBeTruthy();
		expect(secondSession?.user?.id).toBe(firstSession?.user?.id);
		const users = await getDb()
			.select({ id: authUser.id })
			.from(authAccount)
			.innerJoin(authUser, eq(authUser.id, authAccount.userId))
			.where(eq(authAccount.accountId, steamIds[3]!));
		expect(users).toHaveLength(1);
	});

	it('generates distinct usernames for identical Steam display names', async () => {
		const firstFlow = await beginLogin();
		const first = await finishLogin(firstFlow, { steamId: steamIds[0] });
		const secondFlow = await beginLogin();
		const second = await finishLogin(secondFlow, { steamId: steamIds[1] });
		const firstSession = await getSession(sessionCookie(first));
		const secondSession = await getSession(sessionCookie(second));
		expect(firstSession?.user?.name).toBe(secondSession?.user?.name);
		expect(firstSession?.user?.username).not.toBe(secondSession?.user?.username);
	});

	it('continues when Steam verification is unavailable and still does not create a session', async () => {
		const flow = await beginLogin();
		steamUnavailable = true;
		const response = await finishLogin(flow, { steamId: steamIds[2] });
		steamUnavailable = false;
		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toContain('steam_verification_failed');
		expect(sessionCookie(response)).toBe('');
	});

	it('supports profile updates and keeps publishing disabled', async () => {
		const firstFlow = await beginLogin();
		const firstResponse = await finishLogin(firstFlow, { steamId: steamIds[0] });
		const firstSession = await getSession(sessionCookie(firstResponse));
		firstUserId = String(firstSession?.user?.id);
		const conflictUsername = await getDb()
			.select({ username: authUser.username })
			.from(authUser)
			.where(eq(authUser.id, firstUserId));
		const secondFlow = await beginLogin();
		const secondResponse = await finishLogin(secondFlow, { steamId: steamIds[1] });
		const secondSession = await getSession(sessionCookie(secondResponse));
		const secondUserId = String(secondSession?.user?.id);
		expect(await canPublishReports(secondUserId)).toBe(false);
		const { actions } = await import('../../routes/settings/+page.server.js');
		const submitProfile = async (username: string) => {
			const form = new FormData();
			form.set('name', 'Updated TuxGG Display Name');
			form.set('username', username);
			const event = {
				locals: {
					user: {
						id: secondUserId,
						name: 'Steam player 000001',
						username: String(secondSession?.user?.username),
						image: null
					},
					session: { id: 'test-session', expiresAt: new Date(Date.now() + 60_000) }
				},
				request: new Request(`${baseURL}/settings`, { method: 'POST', body: form })
			} as RequestEvent;
			return actions.profile(event as unknown as Parameters<typeof actions.profile>[0]);
		};
		const conflict = await submitProfile(conflictUsername[0]!.username);
		expect(conflict).toMatchObject({ status: 409 });
		const updated = await submitProfile(String(secondSession?.user?.username));
		await expect(Promise.resolve(updated)).rejects.toMatchObject({
			status: 303,
			location: '/settings?saved=1'
		});
		const publicProfile = await getProfile(String(secondSession?.user?.username));
		expect(publicProfile?.name).toBe('Updated TuxGG Display Name');
	});

	it('expires Better Auth sessions and logs out through Better Auth', async () => {
		const flow = await beginLogin();
		const signedIn = await finishLogin(flow, { steamId: steamIds[0] });
		const cookie = sessionCookie(signedIn);
		const session = await getSession(cookie);
		const sessionId = session?.session?.id;
		expect(sessionId).toBeTruthy();
		await getDb()
			.update(authSession)
			.set({ expiresAt: new Date(Date.now() - 60_000) })
			.where(eq(authSession.id, sessionId!));
		expect(await getSession(cookie)).toBeNull();

		const logoutFlow = await beginLogin();
		const logoutSignIn = await finishLogin(logoutFlow, { steamId: steamIds[0] });
		const logoutCookie = sessionCookie(logoutSignIn);
		const signOut = await auth.handler(
			new Request(`${baseURL}/api/auth/sign-out`, {
				method: 'POST',
				headers: { cookie: logoutCookie, origin: baseURL }
			})
		);
		expect(signOut.status).toBe(200);
		expect(await getSession(logoutCookie)).toBeNull();
	});
});
