import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import type { RequestEvent } from '@sveltejs/kit';
import { getAuth } from '#lib/server/auth.js';
import { canPublishReports, canSubmitReports } from '#lib/server/authz.js';
import { closeDatabase, getDb, getPool } from '#lib/server/db/db.js';
import { authAccount, authSession, authUser, authVerification } from '#lib/server/db/schema.js';
import { getProfile } from '#lib/server/db/queries.js';
import { STEAM_OPENID_NAMESPACE, STEAM_OPENID_URL } from './steam-openid.js';

const enabled = process.env.AUTH_INTEGRATION_TESTS === '1';
const databaseUrl = process.env.DATABASE_URL;
const baseURL = process.env.BETTER_AUTH_URL ?? 'https://localhost:5173';
const siteURL = process.env.PUBLIC_SITE_URL ?? 'https://localhost:5173';
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
let steamProfileUnavailable = false;
let auth: ReturnType<typeof getAuth>;
let firstUserId: string | undefined;

function adminTestDatabaseUrl(): string {
	const configured = process.env.PGADMIN_URL;
	if (!configured)
		throw new Error('Auth integration tests require PGADMIN_URL for isolated failure tests.');
	const url = new URL(configured);
	if (url.pathname.replace(/^\//, '') !== 'postgres') {
		throw new Error('Auth integration test administrator URL must connect to postgres.');
	}
	url.pathname = '/tuxgg_test';
	return url.toString();
}

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

async function beginLogin(requestedReturnTo?: string) {
	const clientIp = `192.0.2.${(nonceSequence++ % 200) + 1}`;
	const response = await auth.handler(
		new Request(`${baseURL}/api/auth/steam/login`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				origin: baseURL,
				'x-forwarded-for': clientIp
			},
			body: JSON.stringify(requestedReturnTo ? { returnTo: requestedReturnTo } : {})
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
	const callback = new URL(returnTo);
	expect(callback.origin).toBe(new URL(siteURL).origin);
	expect(callback.pathname).toBe('/api/auth/steam/callback');
	expect(authorizationURL.searchParams.get('openid.realm')).toBe(`${new URL(siteURL).origin}/`);
	return { response, authorizationURL, returnTo, cookies: cookiePairs(response), clientIp };
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
	if (options.signature === undefined) validAssertions.set(signature, fields);
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
	return finishCallback(startAssertion(flow, options), cookies, flow.clientIp);
}

async function finishCallback(callback: URL, cookies: string, clientIp: string) {
	return auth.handler(
		new Request(callback, {
			headers: {
				...(cookies ? { cookie: cookies } : {}),
				'x-forwarded-for': clientIp
			}
		})
	);
}

async function expectNoSteamAccount(steamId: string) {
	const accounts = await getDb()
		.select({ id: authAccount.id })
		.from(authAccount)
		.where(eq(authAccount.accountId, steamId));
	expect(accounts).toHaveLength(0);
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
				const expectedSignedFields = expected?.['openid.signed']?.split(',') ?? [];
				const matchesSignedAssertion =
					expected !== undefined &&
					signedFields.length === expectedSignedFields.length &&
					signedFields.every((field, index) => field === expectedSignedFields[index]) &&
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
				if (steamProfileUnavailable)
					return new Response('Steam profile unavailable', { status: 503 });
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
		if (!process.env.STEAM_API_KEY) {
			throw new Error('Auth integration tests require a non-secret STEAM_API_KEY test value.');
		}
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
		const permissions = await pool.query(
			'SELECT current_user AS role, ' +
				"has_schema_privilege(current_user, 'public', 'USAGE') AS schema_usage, " +
				"has_table_privilege(current_user, 'public.games', 'SELECT') AS can_read_games, " +
				"has_table_privilege(current_user, 'public.user', 'SELECT') AS can_read_auth_users, " +
				"has_table_privilege(current_user, 'public.user', 'UPDATE') AS can_lock_auth_users, " +
				"has_table_privilege(current_user, 'public.account', 'SELECT') AS can_read_accounts, " +
				"has_table_privilege(current_user, 'public.account', 'INSERT') AS can_insert_accounts, " +
				"has_table_privilege(current_user, 'public.account', 'UPDATE') AS can_update_accounts, " +
				"has_table_privilege(current_user, 'public.account', 'DELETE') AS can_delete_accounts, " +
				"has_table_privilege(current_user, 'public.session', 'SELECT') AS can_read_sessions, " +
				"has_table_privilege(current_user, 'public.session', 'INSERT') AS can_insert_sessions, " +
				"has_table_privilege(current_user, 'public.session', 'UPDATE') AS can_update_sessions, " +
				"has_table_privilege(current_user, 'public.session', 'DELETE') AS can_delete_sessions, " +
				"has_table_privilege(current_user, 'public.verification', 'SELECT') AS can_read_verification, " +
				"has_table_privilege(current_user, 'public.verification', 'INSERT') AS can_insert_verification, " +
				"has_table_privilege(current_user, 'public.verification', 'UPDATE') AS can_update_verification, " +
				"has_table_privilege(current_user, 'public.verification', 'DELETE') AS can_delete_verification, " +
				"has_table_privilege(current_user, 'public.native_reports', 'SELECT') AS can_read_native_reports, " +
				"has_table_privilege(current_user, 'public.native_reports', 'INSERT') AS can_insert_native_reports, " +
				"has_column_privilege(current_user, 'public.native_reports', 'content', 'INSERT') AS can_insert_native_content, " +
				"has_column_privilege(current_user, 'public.native_reports', 'moderation_state', 'INSERT') AS can_insert_native_moderation_state, " +
				"has_column_privilege(current_user, 'public.native_reports', 'published_at', 'INSERT') AS can_insert_native_published_at, " +
				"has_table_privilege(current_user, 'public.native_reports', 'UPDATE') AS can_update_native_reports, " +
				"has_table_privilege(current_user, 'public.native_reports', 'DELETE') AS can_delete_native_reports"
		);
		expect(permissions.rows[0]).toEqual({
			role: 'tuxgg_web',
			schema_usage: true,
			can_read_games: true,
			can_read_auth_users: true,
			can_lock_auth_users: true,
			can_read_accounts: true,
			can_insert_accounts: true,
			can_update_accounts: true,
			can_delete_accounts: true,
			can_read_sessions: true,
			can_insert_sessions: true,
			can_update_sessions: true,
			can_delete_sessions: true,
			can_read_verification: true,
			can_insert_verification: true,
			can_update_verification: true,
			can_delete_verification: true,
			can_read_native_reports: true,
			can_insert_native_reports: false,
			can_insert_native_content: true,
			can_insert_native_moderation_state: false,
			can_insert_native_published_at: false,
			can_update_native_reports: false,
			can_delete_native_reports: false
		});
		const nativeColumnPrivileges = await pool.query(
			"SELECT attname, has_column_privilege(current_user, 'public.native_reports', attname, 'INSERT') AS can_insert " +
				"FROM pg_attribute WHERE attrelid = to_regclass('public.native_reports') " +
				'AND attnum > 0 AND NOT attisdropped ORDER BY attnum'
		);
		expect(
			nativeColumnPrivileges.rows
				.filter((row) => row.can_insert)
				.map((row) => row.attname)
				.sort()
		).toEqual(
			[
				'id',
				'app_id',
				'author_id',
				'verdict',
				'platform',
				'proton_version',
				'proton_variant',
				'custom_proton_version',
				'distribution',
				'kernel',
				'cpu',
				'gpu',
				'gpu_driver_detail',
				'gpu_vendor',
				'graphics_driver',
				'ram',
				'device_id',
				'device_name_snapshot',
				'launch_options',
				'performance_notes',
				'known_issues',
				'content'
			].sort()
		);
		// Exercise the actual FK check Better Auth hits when inserting an account for a new user.
		// Roll the probe back so the auth suite only leaves its intentionally isolated test data.
		const privilegeProbe = await pool.connect();
		try {
			await privilegeProbe.query('BEGIN');
			const probeId = `steam-permission-probe-${Date.now()}`;
			await privilegeProbe.query(
				'INSERT INTO public.user (id, name, email, username) VALUES ($1, $2, $3, $4)',
				[probeId, 'Permission probe', `${probeId}@steam.invalid`, `probe-${Date.now()}`]
			);
			await privilegeProbe.query(
				'INSERT INTO public.account (id, account_id, provider_id, user_id) VALUES ($1, $2, $3, $4)',
				[`${probeId}-account`, `${probeId}-steam`, 'steam-permission-probe', probeId]
			);
			await privilegeProbe.query('SELECT id FROM public.user WHERE id = $1 FOR KEY SHARE', [
				probeId
			]);
		} finally {
			await privilegeProbe.query('ROLLBACK');
			privilegeProbe.release();
		}
		await pool.query('SELECT app_id FROM public.games LIMIT 0');
		auth = getAuth();
		installSteamMocks();
	});

	afterAll(async () => {
		vi.stubGlobal('fetch', originalFetch);
		// The suite runs as tuxgg_web, which intentionally cannot delete users. Its randomized
		// identities remain isolated in the disposable tuxgg_test database.
		await closeDatabase();
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
		expect(await canSubmitReports(firstUserId)).toBe(true);
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

	it('persists Better Auth login state before returning the Steam authorization URL', async () => {
		const flow = await beginLogin();
		const callback = new URL(flow.returnTo);
		const state = callback.searchParams.get('state');
		const flowId = callback.searchParams.get('flow');
		expect(state).toBeTruthy();
		expect(flowId).toMatch(/^[a-f0-9]{32}$/);
		const [verification] = await getDb()
			.select({ identifier: authVerification.identifier, value: authVerification.value })
			.from(authVerification)
			.where(eq(authVerification.identifier, `auth-state:${state}`))
			.limit(1);
		expect(verification).toBeTruthy();
		const savedState = JSON.parse(verification!.value) as {
			steamFlowId?: string;
			steamRealm?: string;
			callbackURL?: string;
		};
		expect(savedState.steamFlowId).toBe(flowId);
		expect(savedState.steamRealm).toBe(`${new URL(siteURL).origin}/`);
		expect(savedState.callbackURL).toBe(`${new URL(siteURL).origin}/settings`);
	});

	it('binds a safe report-form return destination to the existing Steam login state', async () => {
		const returnTo = '/games/440/team-fortress-2/report/new';
		const flow = await beginLogin(returnTo);
		const callback = new URL(flow.returnTo);
		const state = callback.searchParams.get('state');
		if (!state) throw new Error('Steam login state was missing.');
		const [verification] = await getDb()
			.select({ value: authVerification.value })
			.from(authVerification)
			.where(eq(authVerification.identifier, `auth-state:${state}`))
			.limit(1);
		const savedState = JSON.parse(verification!.value) as {
			steamReturnTo?: string;
			callbackURL?: string;
		};
		expect(savedState.steamReturnTo).toBe(returnTo);
		expect(savedState.callbackURL).toBe(`${new URL(siteURL).origin}${returnTo}`);
		const response = await finishLogin(flow, { steamId: steamIds[1] });
		expect(response.headers.get('location')).toBe(`${new URL(siteURL).origin}${returnTo}`);
	});

	it('rejects a mismatched request origin before creating login state', async () => {
		const response = await auth.handler(
			new Request(`${baseURL}/api/auth/steam/login`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					origin: 'http://attacker.invalid',
					'x-forwarded-for': '192.0.2.240'
				},
				body: '{}'
			})
		);
		expect(response.status).toBe(403);
	});

	it('rejects an external or protocol-relative login return destination', async () => {
		for (const returnTo of ['https://attacker.invalid/', '//attacker.invalid/']) {
			const response = await auth.handler(
				new Request(`${baseURL}/api/auth/steam/login`, {
					method: 'POST',
					headers: {
						'content-type': 'application/json',
						origin: baseURL,
						'x-forwarded-for': `192.0.2.${(nonceSequence++ % 200) + 1}`
					},
					body: JSON.stringify({ returnTo })
				})
			);
			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({ error: 'request_rejected' });
		}
	});

	it('returns a safe unavailable response when verification-state insertion is denied', async () => {
		const admin = new Pool({
			connectionString: adminTestDatabaseUrl(),
			connectionTimeoutMillis: 5_000
		});
		try {
			const marker = await admin.query(
				'SELECT marker FROM public.tuxgg_test_safety_marker WHERE id = 1'
			);
			expect(marker.rows[0]?.marker).toBe('tuxgg_disposable_test_database_v1');
			await admin.query('REVOKE INSERT ON TABLE public.verification FROM tuxgg_web');
			try {
				const response = await auth.handler(
					new Request(`${baseURL}/api/auth/steam/login`, {
						method: 'POST',
						headers: {
							'content-type': 'application/json',
							origin: baseURL,
							'x-forwarded-for': '192.0.2.241'
						},
						body: '{}'
					})
				);
				expect(response.status).toBe(503);
				expect(await response.json()).toEqual({ error: 'auth_unavailable' });
			} finally {
				await admin.query('GRANT INSERT ON TABLE public.verification TO tuxgg_web');
			}
		} finally {
			await admin.end();
		}
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
		await getDb()
			.insert(authUser)
			.values({ id: `${runId}-old`, name: 'Old account', email, username });
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
			identity: `https://steamcommunity.com/openid/id/${validButForgedId}`,
			signature: 'aW52YWxpZC1zaWduYXR1cmU='
		});
		expect(forged.status).toBe(302);
		expect(forged.headers.get('location')).toContain('steam_verification_failed');
		expect(sessionCookie(forged)).toBe('');
		await expectNoSteamAccount(validButForgedId);

		const tamperedFlow = await beginLogin();
		const tamperedIdentity = '76561198999999998';
		const tamperedCallback = makeCallback(tamperedFlow);
		tamperedCallback.searchParams.set(
			'openid.claimed_id',
			`https://steamcommunity.com/openid/id/${tamperedIdentity}`
		);
		tamperedCallback.searchParams.set(
			'openid.identity',
			`https://steamcommunity.com/openid/id/${tamperedIdentity}`
		);
		const tampered = await finishCallback(
			tamperedCallback,
			tamperedFlow.cookies,
			tamperedFlow.clientIp
		);
		expect(tampered.status).toBe(302);
		expect(tampered.headers.get('location')).toContain('steam_verification_failed');
		expect(sessionCookie(tampered)).toBe('');
		await expectNoSteamAccount(tamperedIdentity);

		const malformedFlow = await beginLogin();
		const malformed = await finishLogin(malformedFlow, {
			claimedId: 'https://steamcommunity.com/openid/id/not-a-steamid'
		});
		expect(malformed.status).toBe(302);
		expect(malformed.headers.get('location')).toContain('steam_verification_failed');
		await expectNoSteamAccount(validButForgedId);
	});

	it('rejects an unexpected Steam OpenID provider without creating an account or session', async () => {
		const flow = await beginLogin();
		const unexpectedProviderId = '76561198999999997';
		const callback = makeCallback(flow, { steamId: unexpectedProviderId });
		callback.searchParams.set('openid.op_endpoint', 'https://attacker.invalid/openid/login');
		const response = await finishCallback(callback, flow.cookies, flow.clientIp);
		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toContain('steam_verification_failed');
		expect(sessionCookie(response)).toBe('');
		await expectNoSteamAccount(unexpectedProviderId);
	});

	it('rejects an incorrect callback URL before sending the assertion to Steam', async () => {
		const flow = await beginLogin();
		const invalidCallbackId = '76561198999999996';
		const response = await finishLogin(flow, {
			steamId: invalidCallbackId,
			returnTo: 'https://attacker.invalid/callback'
		});
		expect(response.headers.get('location')).toContain('steam_verification_failed');
		expect(sessionCookie(response)).toBe('');
		await expectNoSteamAccount(invalidCallbackId);

		const wrongOriginFlow = await beginLogin();
		const wrongOriginId = '76561198999999995';
		const wrongOriginCallback = makeCallback(wrongOriginFlow, { steamId: wrongOriginId });
		wrongOriginCallback.hostname = 'attacker.invalid';
		const wrongOriginResponse = await finishCallback(
			wrongOriginCallback,
			wrongOriginFlow.cookies,
			wrongOriginFlow.clientIp
		);
		expect(wrongOriginResponse.headers.get('location')).toContain('steam_state_invalid');
		expect(sessionCookie(wrongOriginResponse)).toBe('');
		await expectNoSteamAccount(wrongOriginId);
	});

	it('binds each login to the browser and rejects expired or replayed state', async () => {
		const missingCookieFlow = await beginLogin();
		const noCookie = await finishLogin(missingCookieFlow, {}, '');
		expect(noCookie.headers.get('location')).toContain('steam_state_invalid');

		const expiredFlow = await beginLogin();
		const futureNow = Date.now() + 6 * 60_000;
		const timeSpy = vi.spyOn(Date, 'now').mockReturnValue(futureNow);
		let expired: Response;
		try {
			expired = await finishLogin(expiredFlow);
		} finally {
			timeSpy.mockRestore();
		}
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

	it('allows login when optional Steam profile enrichment fails', async () => {
		const steamId = '76561198999999994';
		const flow = await beginLogin();
		steamProfileUnavailable = true;
		let response: Response;
		try {
			response = await finishLogin(flow, { steamId });
		} finally {
			steamProfileUnavailable = false;
		}

		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe(`${siteURL}/settings`);
		const session = await getSession(sessionCookie(response));
		expect(session?.user?.name).toBe(`Steam player ${steamId.slice(-6)}`);
		const accounts = await getDb()
			.select({ providerId: authAccount.providerId, accountId: authAccount.accountId })
			.from(authAccount)
			.where(eq(authAccount.accountId, steamId));
		expect(accounts).toEqual([{ providerId: 'steam', accountId: steamId }]);
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
		await expect(submitProfile(String(secondSession?.user?.username))).rejects.toMatchObject({
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
