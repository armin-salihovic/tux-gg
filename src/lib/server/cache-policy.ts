export const PRIVATE_NO_STORE_CACHE_CONTROL = 'private, no-store';

export function isStaticAssetPath(pathname: string): boolean {
	return (
		pathname.startsWith('/_app/immutable/') ||
		pathname.startsWith('/assets/') ||
		pathname.startsWith('/static/') ||
		pathname === '/favicon.svg'
	);
}

export function applyResponseCachePolicy(
	response: Response,
	authenticated: boolean,
	pathname: string
): Response {
	const isDynamicHtml = response.headers.get('content-type')?.toLowerCase().startsWith('text/html');
	if ((authenticated || isDynamicHtml) && !isStaticAssetPath(pathname)) {
		response.headers.set('cache-control', PRIVATE_NO_STORE_CACHE_CONTROL);
	}
	return response;
}
