export const STEAM_OPENID_URL = 'https://steamcommunity.com/openid/login';
export const STEAM_OPENID_NAMESPACE = 'http://specs.openid.net/auth/2.0';

const IDENTIFIER_SELECT = `${STEAM_OPENID_NAMESPACE}/identifier_select`;
const STEAM_ID_PATTERN = /^7656119\d{10}$/;
const CLAIMED_ID_PATTERN = /^https?:\/\/steamcommunity\.com\/openid\/id\/(7656119\d{10})$/;
const REQUIRED_SIGNED_FIELDS = [
	'op_endpoint',
	'claimed_id',
	'identity',
	'return_to',
	'response_nonce',
	'assoc_handle'
];
const RESPONSE_NONCE_MAX_AGE_MS = 10 * 60 * 1000;
const RESPONSE_NONCE_FUTURE_SKEW_MS = 60 * 1000;
const STEAM_REQUEST_TIMEOUT_MS = 5_000;

export function isSteamId64(value: string): boolean {
	return STEAM_ID_PATTERN.test(value);
}

export function buildSteamOpenIDUrl(realm: string, returnTo: string): string {
	const url = new URL(STEAM_OPENID_URL);
	url.search = new URLSearchParams({
		'openid.ns': STEAM_OPENID_NAMESPACE,
		'openid.mode': 'checkid_setup',
		'openid.return_to': returnTo,
		'openid.realm': realm,
		'openid.identity': IDENTIFIER_SELECT,
		'openid.claimed_id': IDENTIFIER_SELECT
	}).toString();
	return url.toString();
}

function getNonceTimestamp(nonce: string): number | null {
	if (nonce.length > 255) return null;
	const match = nonce.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)[\x21-\x7e]*$/);
	if (!match) return null;
	const timestamp = Date.parse(match[1]!);
	const normalized = Number.isFinite(timestamp)
		? new Date(timestamp).toISOString().replace('.000Z', 'Z')
		: null;
	if (normalized !== match[1]) return null;
	const now = Date.now();
	if (
		timestamp < now - RESPONSE_NONCE_MAX_AGE_MS ||
		timestamp > now + RESPONSE_NONCE_FUTURE_SKEW_MS
	)
		return null;
	return timestamp;
}

function parseDirectVerificationResponse(body: string): Map<string, string> {
	const fields = new Map<string, string>();
	for (const line of body.split(/\r?\n/)) {
		if (!line) continue;
		const separator = line.indexOf(':');
		if (separator < 1) throw new Error('Steam returned an invalid OpenID verification response.');
		const key = line.slice(0, separator);
		if (fields.has(key)) throw new Error('Steam returned duplicate OpenID verification fields.');
		fields.set(key, line.slice(separator + 1));
	}
	return fields;
}

export async function verifySteamOpenIDResponse(
	params: URLSearchParams,
	expectedReturnTo: string,
	fetcher: typeof fetch = fetch
): Promise<{ steamId: string; responseNonce: string; nonceExpiresAt: Date }> {
	if ([...params].length > 40) throw new Error('Steam returned too many OpenID fields.');
	const seen = new Set<string>();
	const assertion = new URLSearchParams();
	for (const [key, value] of params) {
		if (key.startsWith('openid.')) {
			if (seen.has(key) || value.length > 2048)
				throw new Error('Steam returned duplicate or oversized OpenID fields.');
			seen.add(key);
			assertion.append(key, value);
		}
	}

	if (params.get('openid.ns') !== STEAM_OPENID_NAMESPACE)
		throw new Error('Invalid Steam OpenID namespace.');
	if (params.get('openid.mode') !== 'id_res')
		throw new Error('Steam did not return a positive OpenID assertion.');
	if (params.get('openid.op_endpoint') !== STEAM_OPENID_URL)
		throw new Error('Unexpected Steam OpenID provider.');
	if (params.get('openid.return_to') !== expectedReturnTo)
		throw new Error('Steam returned to an unexpected URL.');

	const claimedId = params.get('openid.claimed_id');
	const identity = params.get('openid.identity');
	const match = claimedId?.match(CLAIMED_ID_PATTERN);
	if (!match || identity !== claimedId)
		throw new Error('Steam returned an invalid SteamID64 identity.');

	const associationHandle = params.get('openid.assoc_handle');
	const signature = params.get('openid.sig');
	const signedFieldsValue = params.get('openid.signed');
	const responseNonce = params.get('openid.response_nonce');
	if (
		!associationHandle ||
		associationHandle.length > 255 ||
		!/^[\x21-\x7e]+$/.test(associationHandle) ||
		!signature ||
		!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(signature) ||
		!signedFieldsValue ||
		!responseNonce
	) {
		throw new Error('Steam returned an incomplete OpenID assertion.');
	}
	const nonceTimestamp = getNonceTimestamp(responseNonce);
	if (nonceTimestamp === null)
		throw new Error('Steam returned an expired or invalid OpenID nonce.');

	const signedFields = signedFieldsValue.split(',');
	if (
		new Set(signedFields).size !== signedFields.length ||
		signedFields.some((field) => !/^[A-Za-z0-9_.-]+$/.test(field)) ||
		REQUIRED_SIGNED_FIELDS.some((field) => !signedFields.includes(field))
	) {
		throw new Error('Steam did not sign all required OpenID fields.');
	}

	assertion.set('openid.mode', 'check_authentication');
	const response = await fetcher(STEAM_OPENID_URL, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: assertion.toString(),
		redirect: 'manual',
		signal: AbortSignal.timeout(STEAM_REQUEST_TIMEOUT_MS)
	});
	if (response.status !== 200) throw new Error('Steam OpenID verification is unavailable.');
	const text = await response.text();
	if (text.length > 4096)
		throw new Error('Steam returned an oversized OpenID verification response.');
	const verification = parseDirectVerificationResponse(text);
	if (
		verification.get('ns') !== STEAM_OPENID_NAMESPACE ||
		verification.get('is_valid') !== 'true'
	) {
		throw new Error('Steam rejected the OpenID assertion.');
	}

	return {
		steamId: match[1]!,
		responseNonce,
		nonceExpiresAt: new Date(nonceTimestamp + RESPONSE_NONCE_MAX_AGE_MS)
	};
}

export interface SteamPlayerSummary {
	steamid: string;
	personaname: string;
	avatarfull?: string;
	profileurl?: string;
}

export interface SteamProfile {
	name: string;
	image?: string;
	profileUrl: string;
}

export async function fetchSteamProfile(
	steamId: string,
	apiKey: string | undefined,
	fetcher: typeof fetch = fetch
): Promise<SteamProfile | null> {
	if (!apiKey?.trim()) return null;
	const url = new URL('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/');
	url.searchParams.set('key', apiKey.trim());
	url.searchParams.set('steamids', steamId);
	const response = await fetcher(url, {
		redirect: 'manual',
		signal: AbortSignal.timeout(STEAM_REQUEST_TIMEOUT_MS)
	});
	if (response.status !== 200) throw new Error('Steam profile lookup failed.');
	const data = (await response.json()) as { response?: { players?: unknown[] } };
	const player = data.response?.players?.[0];
	if (!player || typeof player !== 'object') return null;
	const summary = player as Partial<SteamPlayerSummary>;
	if (summary.steamid !== steamId || typeof summary.personaname !== 'string') return null;
	const name = summary.personaname.trim().slice(0, 60);
	if (!name) return null;
	let image: string | undefined;
	if (typeof summary.avatarfull === 'string') {
		try {
			const avatar = new URL(summary.avatarfull);
			if (
				avatar.protocol === 'https:' &&
				['avatars.steamstatic.com', 'avatars.akamai.steamstatic.com'].includes(avatar.hostname)
			) {
				image = avatar.toString();
			}
		} catch {
			// Ignore an invalid optional avatar and keep the profile usable.
		}
	}
	let profileUrl = `https://steamcommunity.com/profiles/${steamId}/`;
	if (typeof summary.profileurl === 'string') {
		try {
			const candidate = new URL(summary.profileurl);
			if (
				candidate.protocol === 'https:' &&
				candidate.hostname === 'steamcommunity.com' &&
				/^\/(?:profiles\/\d+|id\/[a-z0-9_-]+)\/?$/i.test(candidate.pathname)
			) {
				profileUrl = candidate.toString();
			}
		} catch {
			// Use the SteamID64 profile URL if the API omits an acceptable URL.
		}
	}
	return { name, profileUrl, ...(image ? { image } : {}) };
}
