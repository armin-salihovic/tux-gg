export const AUTHENTICATED_CACHE_CONTROL = 'private, no-store';

export function isStaticAssetPath(pathname: string): boolean {
	return (
		pathname.startsWith('/_app/immutable/') ||
		pathname.startsWith('/assets/') ||
		pathname.startsWith('/static/') ||
		pathname === '/favicon.svg'
	);
}

export function applyAuthenticatedCachePolicy(
	response: Response,
	authenticated: boolean,
	pathname: string
): Response {
	if (authenticated && !isStaticAssetPath(pathname)) {
		response.headers.set('cache-control', AUTHENTICATED_CACHE_CONTROL);
	}
	return response;
}
