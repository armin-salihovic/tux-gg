import { describe, expect, it } from 'vitest';
import {
	applyResponseCachePolicy,
	PRIVATE_NO_STORE_CACHE_CONTROL,
	isStaticAssetPath
} from './cache-policy.js';

describe('response cache policy', () => {
	it('prevents shared and browser caching of authenticated HTML', () => {
		const response = new Response('<html>account</html>', {
			headers: {
				'content-type': 'text/html; charset=utf-8',
				'cache-control': 'public, max-age=30, stale-while-revalidate=120'
			}
		});

		applyResponseCachePolicy(response, true, '/games');

		expect(response.headers.get('cache-control')).toBe(PRIVATE_NO_STORE_CACHE_CONTROL);
	});

	it('does not cache anonymous dynamic HTML during the MVP', () => {
		const response = new Response('<html>public catalog</html>', {
			headers: {
				'content-type': 'text/html; charset=utf-8',
				'cache-control': 'public, max-age=30'
			}
		});

		applyResponseCachePolicy(response, false, '/games');

		expect(response.headers.get('cache-control')).toBe(PRIVATE_NO_STORE_CACHE_CONTROL);
	});

	it('keeps public anonymous response policy intact', () => {
		const response = new Response('<html>anonymous</html>', {
			headers: { 'cache-control': 'public, max-age=30' }
		});

		applyResponseCachePolicy(response, false, '/api/catalog.json');

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

			applyResponseCachePolicy(response, true, pathname);

			expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
			expect(isStaticAssetPath(pathname)).toBe(true);
		}
	});

	it('keeps file-like personalized routes private', () => {
		const response = new Response('private avatar');
		applyResponseCachePolicy(response, true, '/users/alex/avatar.png');
		expect(response.headers.get('cache-control')).toBe(PRIVATE_NO_STORE_CACHE_CONTROL);
	});
});
