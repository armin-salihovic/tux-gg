import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import { getAuth } from '#lib/server/auth.js';
import { canPublishReports } from '#lib/server/authz.js';
import { closeDatabase, getDb, getPool } from '#lib/server/db/db.js';
import { authAccount, authSession, authUser } from '#lib/server/db/schema.js';
import { getProfile } from '#lib/server/db/queries.js';

const enabled = process.env.AUTH_INTEGRATION_TESTS === '1';
const databaseUrl = process.env.DATABASE_URL;
const baseURL = process.env.BETTER_AUTH_URL ?? 'https://localhost:5173';
const runId = `tuxgg-auth-test-${Date.now()}`;
const profileId = {
	first: `918273645${Date.now() % 1000}`,
	second: `918273646${Date.now() % 1000}`
};
const codes = ['first-login', 'returning-login', 'matching-email', 'second-user'];
const fakeProfiles = new Map<string, Record<string, unknown>>();
const tokenToProfileId = new Map<string, string>();
const originalFetch = globalThis.fetch;
let auth: ReturnType<typeof getAuth>;
let firstUserId: string | undefined;
let secondUserId: string | undefined;

function cookiesFrom(response: Response): string {
	const headers = response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''];
	return headers
		.map((cookie) => cookie.split(';', 1)[0])
		.filter((cookie) => cookie.startsWith('tuxgg.') || cookie.startsWith('__Secure-tuxgg.'))
		.join('; ');
}

function setCookieHeaders(response: Response): string[] {
	return response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''];
}

async function beginLogin(code: string) {
	const response = await auth.handler(
		new Request(`${baseURL}/api/auth/sign-in/social`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: baseURL },
			body: JSON.stringify({
				provider: 'discord',
				callbackURL: '/settings',
				disableRedirect: true
			})
		})
	);
	expect(response.status).toBe(200);
	const body = (await response.json()) as { url: string };
	const authorizationURL = new URL(body.url);
	expect(authorizationURL.origin).toBe('https://discord.com');
	expect(authorizationURL.searchParams.get('client_id')).toBe('ci-only-client-id');
	return {
		code,
		state: authorizationURL.searchParams.get('state'),
		cookies: cookiesFrom(response)
	};
}

async function finishLogin(flow: Awaited<ReturnType<typeof beginLogin>>) {
	if (!flow.state) throw new Error('Discord authorization did not include state.');
	return auth.handler(
		new Request(
			`${baseURL}/api/auth/callback/discord?code=${encodeURIComponent(flow.code)}&state=${encodeURIComponent(flow.state)}`,
			{ headers: { cookie: flow.cookies } }
		)
	);
}

async function getSession(
	cookie: string
): Promise<{ session: { id: string } | null; user: Record<string, unknown> | null } | null> {
	const response = await auth.handler(
		new Request(`${baseURL}/api/auth/get-session`, { headers: cookie ? { cookie } : {} })
	);
	return (await response.json()) as {
		session: { id: string } | null;
		user: Record<string, unknown> | null;
	} | null;
}

function installDiscordMocks() {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			const url = new URL(
				typeof input === 'string' ? input : input instanceof Request ? input.url : input.href
			);
			if (url.pathname.endsWith('/oauth2/token')) {
				const body =
					typeof init?.body === 'string'
						? new URLSearchParams(init.body)
						: init?.body instanceof URLSearchParams
							? init.body
							: new URLSearchParams();
				const code = body.get('code');
				const token = `ci-access-${code}`;
				if (code) tokenToProfileId.set(token, code);
				return Response.json({
					access_token: token,
					token_type: 'Bearer',
					expires_in: 3600,
					refresh_token: `ci-refresh-${code}`,
					scope: 'identify email'
				});
			}
			if (decodeURIComponent(url.pathname).endsWith('/users/@me')) {
				const token = new Headers(init?.headers).get('authorization')?.replace(/^Bearer\s+/i, '');
				const code = token ? tokenToProfileId.get(token) : undefined;
				const profile = code ? fakeProfiles.get(code) : undefined;
				return profile
					? Response.json(profile)
					: Response.json({ message: 'Unauthorized' }, { status: 401 });
			}
			throw new Error(
				`Unexpected network request in mocked Discord flow: ${url.hostname}${url.pathname}`
			);
		})
	);
}

describe.skipIf(!enabled)('Discord OAuth and session integration', () => {
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
		if (process.env.DISCORD_CLIENT_ID !== 'ci-only-client-id') {
			throw new Error('Auth integration tests require the CI-only Discord app credentials.');
		}
		auth = getAuth();
		fakeProfiles.set(codes[0], {
			id: profileId.first,
			username: 'first-player',
			avatar: null,
			discriminator: '0'
		});
		fakeProfiles.set(codes[1], {
			id: profileId.first,
			username: 'renamed-on-discord',
			global_name: 'Updated Discord Name',
			avatar: null,
			discriminator: '0'
		});
		fakeProfiles.set(codes[2], {
			id: profileId.second,
			username: 'same-email-player',
			email: `${profileId.first}@discord.placeholder.local`,
			verified: true,
			avatar: 'avatar-hash'
		});
		fakeProfiles.set(codes[3], {
			id: profileId.second,
			username: 'second-player',
			email: `${runId}-second@example.test`,
			verified: true,
			avatar: 'avatar-hash'
		});
		installDiscordMocks();
	});

	afterAll(async () => {
		vi.stubGlobal('fetch', originalFetch);
		try {
			const userIds = [firstUserId, secondUserId].filter((id): id is string => Boolean(id));
			if (userIds.length) {
				await getDb().delete(authUser).where(inArray(authUser.id, userIds));
			}
		} finally {
			await closeDatabase();
		}
	});

	it('creates accounts, blocks implicit linking, persists/revokes sessions, and protects publication', async () => {
		const firstFlow = await beginLogin(codes[0]!);
		const firstResponse = await finishLogin(firstFlow);
		expect(firstResponse.status).toBe(302);
		expect(process.env.NODE_ENV).toBe('production');
		expect(new URL(baseURL).protocol).toBe('https:');
		let cookie = cookiesFrom(firstResponse);
		expect(cookie).toMatch(/tuxgg\.session_token=/);
		const sessionCookies = setCookieHeaders(firstResponse).filter(
			(value) =>
				value.startsWith('tuxgg.session_token=') ||
				value.startsWith('__Secure-tuxgg.session_token=')
		);
		expect(sessionCookies.join('; ')).toMatch(/HttpOnly/i);
		if (process.env.NODE_ENV === 'production') expect(sessionCookies.join('; ')).toMatch(/Secure/i);
		const firstSession = await getSession(cookie);
		expect(firstSession?.user?.name).toBe('first-player');
		expect(firstSession?.user?.email).toBe(`${profileId.first}@discord.placeholder.local`);
		firstUserId = String(firstSession?.user?.id);
		expect(await canPublishReports(firstUserId)).toBe(false);
		expect(JSON.stringify(firstSession)).not.toContain('ci-access-');

		const privateAccount = await getDb()
			.select({ accessToken: authAccount.accessToken, refreshToken: authAccount.refreshToken })
			.from(authAccount)
			.where(eq(authAccount.userId, firstUserId));
		expect(privateAccount[0]?.accessToken).toContain('ci-access-');
		expect(JSON.stringify(await getProfile(String(firstSession?.user?.username)))).not.toContain(
			'discord.placeholder.local'
		);
		expect(await getProfile(String(firstSession?.user?.username))).not.toHaveProperty('email');

		const returningFlow = await beginLogin(codes[1]!);
		const returningResponse = await finishLogin(returningFlow);
		expect(returningResponse.status).toBe(302);
		cookie = cookiesFrom(returningResponse);
		const returningSession = await getSession(cookie);
		expect(returningSession?.user?.id).toBe(firstUserId);
		const userCount = await getDb()
			.select({ id: authUser.id })
			.from(authUser)
			.where(eq(authUser.id, firstUserId));
		expect(userCount).toHaveLength(1);

		const invalidResponse = await auth.handler(
			new Request(`${baseURL}/api/auth/callback/discord?code=invalid&state=invalid-state`)
		);
		expect(invalidResponse.status).toBe(302);
		expect(invalidResponse.headers.get('location')).toContain('error=');

		const linkedFlow = await beginLogin(codes[2]!);
		const linkedResponse = await finishLogin(linkedFlow);
		expect(linkedResponse.status).toBe(302);
		expect(linkedResponse.headers.get('location')).toContain('error=');
		const firstAccount = await getDb()
			.select({ id: authAccount.id })
			.from(authAccount)
			.where(eq(authAccount.userId, firstUserId));
		expect(firstAccount).toHaveLength(1);

		const secondFlow = await beginLogin(codes[3]!);
		const secondResponse = await finishLogin(secondFlow);
		expect(secondResponse.status).toBe(302);
		const secondCookie = cookiesFrom(secondResponse);
		const secondSession = await getSession(secondCookie);
		expect(secondSession?.user?.id).toBeTruthy();
		secondUserId = String(secondSession?.user?.id);
		expect(secondUserId).not.toBe(firstUserId);
		expect(await canPublishReports(secondUserId)).toBe(false);

		const duplicateUsername = await getDb()
			.select({ username: authUser.username })
			.from(authUser)
			.where(eq(authUser.id, firstUserId));
		const { actions } = await import('../../routes/settings/+page.server.js');
		const submitProfile = async (name: string, username: string) => {
			const form = new FormData();
			form.set('name', name);
			form.set('username', username);
			const request = new Request(`${baseURL}/settings`, { method: 'POST', body: form });
			const event = {
				locals: {
					user: { id: secondUserId!, name: 'Second User', username: 'second-player', image: null },
					session: { id: 'test-session', expiresAt: new Date(Date.now() + 60_000) }
				},
				request
			} as RequestEvent;
			return actions.profile(event as unknown as Parameters<typeof actions.profile>[0]);
		};
		const conflict = await submitProfile('Second User', duplicateUsername[0]!.username);
		expect(conflict).toMatchObject({ status: 409 });
		await expect(
			submitProfile('Updated Profile Name', 'second-player-updated')
		).rejects.toMatchObject({
			status: 303,
			location: '/settings?saved=1'
		});
		const updatedProfile = await getDb()
			.select({ name: authUser.name, username: authUser.username })
			.from(authUser)
			.where(eq(authUser.id, secondUserId));
		expect(updatedProfile[0]).toEqual({
			name: 'Updated Profile Name',
			username: 'second-player-updated'
		});

		const expiry = await getSession(cookie);
		const sessionId = expiry?.session?.id;
		expect(sessionId).toBeTruthy();
		await getDb()
			.update(authSession)
			.set({ expiresAt: new Date(Date.now() - 60_000) })
			.where(eq(authSession.id, sessionId!));
		expect(await getSession(cookie)).toBeNull();

		const logoutFlow = await beginLogin(codes[1]!);
		const logoutResponse = await finishLogin(logoutFlow);
		const logoutCookie = cookiesFrom(logoutResponse);
		const signOutResponse = await auth.handler(
			new Request(`${baseURL}/api/auth/sign-out`, {
				method: 'POST',
				headers: { cookie: logoutCookie, origin: baseURL }
			})
		);
		expect(signOutResponse.status).toBe(200);
		expect(await getSession(logoutCookie)).toBeNull();
	});
});
