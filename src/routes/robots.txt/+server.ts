import { absoluteUrl } from '#lib/server/seo.js';

export function GET() {
	const body = `User-agent: *\nAllow: /\nDisallow: /settings\nDisallow: /login\nDisallow: /api/\nSitemap: ${absoluteUrl('/sitemap.xml')}\n`;
	return new Response(body, {
		headers: {
			'content-type': 'text/plain; charset=utf-8',
			'cache-control': 'public, max-age=3600'
		}
	});
}
