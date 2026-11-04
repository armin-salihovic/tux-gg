import { PUBLIC_SITE_URL } from '$app/env/private';

export function GET() {
	const base = (PUBLIC_SITE_URL || 'http://localhost:5173').replace(/\/$/, '');
	const body = `User-agent: *\nAllow: /\nDisallow: /settings\nDisallow: /login\nDisallow: /api/\nSitemap: ${base}/sitemap.xml\n`;
	return new Response(body, {
		headers: {
			'content-type': 'text/plain; charset=utf-8',
			'cache-control': 'public, max-age=3600'
		}
	});
}
