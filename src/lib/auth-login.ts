export const STEAM_LOGIN_MESSAGES = {
	notConfigured:
		'Authentication is not configured. Check the local sign-in settings and restart the server.',
	unavailable: 'Authentication service is temporarily unavailable. Try again shortly.',
	rejected: 'Sign-in request was rejected. Reload the page and try again.',
	network: 'Could not reach the sign-in service. Check your connection and try again.'
} as const;

type SteamLoginResponse = { url?: unknown; error?: unknown };

function publicErrorMessage(status: number, errorCode: unknown): string {
	if (errorCode === 'auth_not_configured') return STEAM_LOGIN_MESSAGES.notConfigured;
	if (errorCode === 'request_rejected' || status === 400 || status === 403)
		return STEAM_LOGIN_MESSAGES.rejected;
	if (!status || status >= 500) return STEAM_LOGIN_MESSAGES.unavailable;
	return STEAM_LOGIN_MESSAGES.rejected;
}

function isSteamAuthorizationURL(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	try {
		const url = new URL(value);
		const callback = url.searchParams.get('openid.return_to');
		const realm = url.searchParams.get('openid.realm');
		if (!callback || !realm) return false;
		const callbackURL = new URL(callback);
		return (
			url.protocol === 'https:' &&
			url.origin === 'https://steamcommunity.com' &&
			url.pathname === '/openid/login' &&
			url.searchParams.get('openid.mode') === 'checkid_setup' &&
			callbackURL.origin === new URL(realm).origin &&
			callbackURL.pathname.endsWith('/steam/callback')
		);
	} catch {
		return false;
	}
}

export async function startSteamLogin(
	fetcher: typeof fetch = fetch
): Promise<{ url: string } | { error: string }> {
	let response: Response;
	try {
		response = await fetcher('/api/auth/steam/login', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}'
		});
	} catch {
		return { error: STEAM_LOGIN_MESSAGES.network };
	}

	let result: SteamLoginResponse;
	try {
		result = (await response.json()) as SteamLoginResponse;
	} catch {
		return { error: publicErrorMessage(response.status, undefined) };
	}
	if (!response.ok) return { error: publicErrorMessage(response.status, result.error) };
	if (!isSteamAuthorizationURL(result.url)) return { error: STEAM_LOGIN_MESSAGES.unavailable };
	return { url: result.url };
}
