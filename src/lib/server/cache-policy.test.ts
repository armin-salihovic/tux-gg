import { describe, expect, it } from 'vitest';
import {
	applyAuthenticatedCachePolicy,
	AUTHENTICATED_CACHE_CONTROL,
	isStaticAssetPath
} from './cache-policy.js';

describe('authenticated response cache policy', () => {
	it('prevents shared and browser caching of authenticated HTML', () => {
		const response = new Response('<html>account</html>', {
			headers: { 'cache-control': 'public, max-age=30, stale-while-revalidate=120' }
		});

		applyAuthenticatedCachePolicy(response, true, '/games');

		expect(response.headers.get('cache-control')).toBe(AUTHENTICATED_CACHE_CONTROL);
	});

	it('keeps public anonymous response policy intact', () => {
		const response = new Response('<html>anonymous</html>', {
			headers: { 'cache-control': 'public, max-age=30' }
		});

		applyAuthenticatedCachePolicy(response, false, '/games');

		expect(response.headers.get('cache-control')).toBe('public, max-age=30');
	});

	it('does not rewrite cache policy for static assets', () => {
		for (const pathname of [
			'/_app/immutable/entry/start.js',
			'/assets/tuxgg.css',
			'/static/images/fallback.webp',
			'/favicon.svg'
		]) {
			const response = new Response('asset', {
				headers: { 'cache-control': 'public, max-age=31536000, immutable' }
			});

			applyAuthenticatedCachePolicy(response, true, pathname);

			expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
			expect(isStaticAssetPath(pathname)).toBe(true);
		}
	});

	it('keeps file-like personalized routes private', () => {
		const response = new Response('private avatar');
		applyAuthenticatedCachePolicy(response, true, '/users/alex/avatar.png');
		expect(response.headers.get('cache-control')).toBe(AUTHENTICATED_CACHE_CONTROL);
	});
});
