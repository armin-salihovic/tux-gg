import { createHash, randomBytes } from 'node:crypto';
import { HIDE_METADATA, generateGenericState, parseGenericState } from 'better-auth';
import type { BetterAuthPlugin, StateData } from 'better-auth';
import { createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { handleOAuthUserInfo } from 'better-auth/oauth2';
import { and, eq, like, lt } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '#lib/server/db/db.js';
import { authUser, authVerification } from '#lib/server/db/schema.js';
import {
	buildSteamOpenIDUrl,
	fetchSteamProfile,
	STEAM_OPENID_URL,
	verifySteamOpenIDResponse
} from './steam-openid.js';

const STEAM_PROVIDER_ID = 'steam';
const FLOW_TTL_MS = 5 * 60 * 1000;
const flowCookieName = (flowId: string) => `steam_state_${flowId}`;

function loginErrorURL(origin: string, code: string): string {
	const url = new URL('/login', origin);
	url.searchParams.set('error', code);
	return url.toString();
}

function authPath(ctx: Parameters<typeof handleOAuthUserInfo>[0]): string {
	const basePath = ctx.context.options.basePath ?? '/api/auth';
	const parsed = new URL(basePath, 'http://localhost');
	if (
		!basePath.startsWith('/') ||
		parsed.origin !== 'http://localhost' ||
		parsed.search ||
		parsed.hash ||
		parsed.pathname.split('/').some((segment) => segment === '.' || segment === '..')
	) {
		throw new Error('Better Auth has an invalid authentication base path.');
	}
	return parsed.pathname.replace(/\/+$/, '');
}

export function getTrustedSiteOrigin(
	siteURL: string,
	internalBaseURL: string,
	configuredAuthPath: string
): string {
	let site: URL;
	let internal: URL;
	try {
		site = new URL(siteURL);
		internal = new URL(internalBaseURL);
	} catch {
		throw new Error('PUBLIC_SITE_URL and Better Auth base URL must be valid absolute URLs.');
	}
	const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
	if (site.protocol !== 'https:' && !(site.protocol === 'http:' && localHosts.has(site.hostname))) {
		throw new Error('PUBLIC_SITE_URL must use HTTPS outside localhost development.');
	}
	if (
		site.pathname !== '/' ||
		site.username ||
		site.password ||
		site.search ||
		site.hash ||
		internal.origin !== site.origin ||
		internal.pathname.replace(/\/+$/, '') !== configuredAuthPath ||
		internal.username ||
		internal.password ||
		internal.search ||
		internal.hash
	) {
		throw new Error('The configured site origin and Better Auth base URL do not match.');
	}
	return site.origin;
}

function usernameCandidates(profileName: string, steamId: string): string[] {
	const stem =
		profileName
			.normalize('NFKD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9_-]+/g, '-')
			.replace(/^[^a-z0-9]+|[-_]+$/g, '')
			.slice(0, 15) || 'player';
	const hash = createHash('sha256').update(steamId).digest('hex');
	return [8, 12, 16].map((length) => `${stem.slice(0, 23 - length)}-${hash.slice(0, length)}`);
}

async function usernameExists(username: string): Promise<boolean> {
	const [existing] = await getDb()
		.select({ id: authUser.id })
		.from(authUser)
		.where(eq(authUser.username, username))
		.limit(1);
	return Boolean(existing);
}

async function createSteamSession(
	ctx: Parameters<typeof handleOAuthUserInfo>[0],
	steamId: string,
	steamName: string,
	image: string | undefined
) {
	const email = `steam-${steamId}@steam.invalid`;
	const candidates = usernameCandidates(steamName, steamId);
	const signIn = (username: string) => {
		const userInfo = {
			id: steamId,
			email,
			emailVerified: false,
			name: steamName,
			username,
			...(image ? { image } : {})
		} as Parameters<typeof handleOAuthUserInfo>[1]['userInfo'];
		return handleOAuthUserInfo(ctx, {
			userInfo,
			account: { providerId: STEAM_PROVIDER_ID, accountId: steamId },
			trustProviderByName: false,
			overrideUserInfo: false
		});
	};
	const signedInAccount = await ctx.context.internalAdapter.findAccountOwnerByKey({
		providerId: STEAM_PROVIDER_ID,
		accountId: steamId
	});
	if (signedInAccount?.kind === 'owned') {
		try {
			const result = await signIn(candidates[0]!);
			return result.error === null ? result.data : null;
		} catch {
			return null;
		}
	}
	if (signedInAccount?.kind === 'orphaned') return null;
	for (const username of candidates) {
		if (await usernameExists(username)) {
			const racedAccount = await ctx.context.internalAdapter.findAccountOwnerByKey({
				providerId: STEAM_PROVIDER_ID,
				accountId: steamId
			});
			if (!racedAccount) continue;
			if (racedAccount.kind === 'orphaned') return null;
			try {
				const retry = await signIn(username);
				return retry.error === null ? retry.data : null;
			} catch {
				return null;
			}
		}
		let result: Awaited<ReturnType<typeof handleOAuthUserInfo>>;
		try {
			result = await signIn(username);
		} catch {
			return null;
		}
		if (result.error === null) return result.data;
		if (result.error !== 'unable to create user') return null;

		// A simultaneous login for the same SteamID may have committed the account
		// after Better Auth's first lookup. Retry so the losing request signs into it.
		const existingAccount = await ctx.context.internalAdapter.findAccountOwnerByKey({
			providerId: STEAM_PROVIDER_ID,
			accountId: steamId
		});
		if (existingAccount) {
			if (existingAccount.kind === 'orphaned') return null;
			const retry = await signIn(username);
			if (retry.error === null) return retry.data;
			return null;
		}
	}
	return null;
}

export function steamOpenID(apiKey: string | undefined, siteURL: string): BetterAuthPlugin {
	return {
		id: 'steam-openid',
		endpoints: {
			steamLogin: createAuthEndpoint(
				'/steam/login',
				{
					method: 'POST',
					body: z.object({}),
					requireHeaders: true,
					requireRequest: true,
					metadata: { openapi: { description: 'Start Steam OpenID sign-in.' } }
				},
				async (ctx) => {
					const basePath = authPath(ctx);
					const origin = getTrustedSiteOrigin(siteURL, ctx.context.baseURL, basePath);
					const realm = `${origin}/`;
					const flowId = randomBytes(16).toString('hex');
					const generated = await generateGenericState(
						ctx,
						{
							callbackURL: new URL('/settings', origin).toString(),
							errorURL: new URL('/login', origin).toString(),
							codeVerifier: randomBytes(32).toString('base64url'),
							expiresAt: Date.now() + FLOW_TTL_MS,
							steamFlowId: flowId,
							steamRealm: realm
						} as StateData,
						{ cookieName: flowCookieName(flowId) }
					);
					const returnTo = new URL(`${authPath(ctx)}/steam/callback`, origin);
					returnTo.searchParams.set('flow', flowId);
					returnTo.searchParams.set('state', generated.state);
					const url = buildSteamOpenIDUrl(realm, returnTo.toString());
					ctx.setHeader('Location', url);
					return ctx.json({ url, redirect: true });
				}
			),
			steamCallback: createAuthEndpoint(
				'/steam/callback',
				{
					method: 'GET',
					query: z.object({ flow: z.string(), state: z.string() }),
					requireRequest: true,
					metadata: { ...HIDE_METADATA, openapi: { description: 'Steam OpenID callback.' } }
				},
				async (ctx) => {
					const basePath = authPath(ctx);
					const origin = getTrustedSiteOrigin(siteURL, ctx.context.baseURL, basePath);
					const callback = new URL(`${basePath}/steam/callback`, origin);
					const currentURL = new URL(ctx.request.url);
					const params = currentURL.searchParams;
					const flowValues = params.getAll('flow');
					const stateValues = params.getAll('state');
					const flowId = flowValues[0];
					const state = stateValues[0];
					if (
						!flowId ||
						!/^[a-f0-9]{32}$/.test(flowId) ||
						!state ||
						flowValues.length !== 1 ||
						stateValues.length !== 1 ||
						currentURL.origin !== origin ||
						currentURL.pathname !== callback.pathname
					) {
						throw ctx.redirect(loginErrorURL(origin, 'steam_state_invalid'));
					}

					let stateData: Awaited<ReturnType<typeof parseGenericState>>;
					try {
						stateData = await parseGenericState(ctx, state, {
							cookieName: flowCookieName(flowId)
						});
					} catch {
						throw ctx.redirect(loginErrorURL(origin, 'steam_state_invalid'));
					}
					const flow = stateData as typeof stateData & {
						steamFlowId?: unknown;
						steamRealm?: unknown;
					};
					const realm = `${origin}/`;
					const returnTo = new URL(callback);
					returnTo.searchParams.set('flow', flowId);
					returnTo.searchParams.set('state', state);
					if (
						flow.steamFlowId !== flowId ||
						flow.steamRealm !== realm ||
						flow.callbackURL !== new URL('/settings', origin).toString()
					) {
						throw ctx.redirect(loginErrorURL(origin, 'steam_state_invalid'));
					}

					let verified: Awaited<ReturnType<typeof verifySteamOpenIDResponse>>;
					try {
						verified = await verifySteamOpenIDResponse(params, returnTo.toString());
						const nonceHash = createHash('sha256')
							.update(`${STEAM_OPENID_URL}\n${verified.responseNonce}`)
							.digest('hex');
						await getDb()
							.delete(authVerification)
							.where(
								and(
									like(authVerification.identifier, 'steam-openid-nonce:%'),
									lt(authVerification.expiresAt, new Date())
								)
							);
						const reserved = await ctx.context.internalAdapter.reserveVerificationValue({
							identifier: `steam-openid-nonce:${nonceHash}`,
							value: verified.steamId,
							expiresAt: verified.nonceExpiresAt
						});
						if (!reserved) throw new Error('Steam OpenID response nonce was already used.');
					} catch {
						ctx.context.logger.warn('Steam OpenID callback verification failed.');
						throw ctx.redirect(loginErrorURL(origin, 'steam_verification_failed'));
					}

					let profile = null;
					if (apiKey?.trim()) {
						try {
							profile = await fetchSteamProfile(verified.steamId, apiKey);
						} catch {
							ctx.context.logger.warn(
								'Steam profile enrichment failed; using fallback profile details.'
							);
						}
					}
					const steamName = profile?.name ?? `Steam player ${verified.steamId.slice(-6)}`;
					const session = await createSteamSession(
						ctx,
						verified.steamId,
						steamName,
						profile?.image
					);
					if (!session) {
						ctx.context.logger.warn('Steam sign-in could not create or retrieve a TuxGG account.');
						throw ctx.redirect(loginErrorURL(origin, 'steam_account_unavailable'));
					}
					await setSessionCookie(ctx, session);
					throw ctx.redirect(flow.callbackURL);
				}
			)
		},
		rateLimit: [{ pathMatcher: (path) => path.includes('/steam/'), window: 60, max: 10 }]
	} satisfies BetterAuthPlugin;
}
