import { absoluteUrl } from '#lib/server/seo.js';

const paths = [
	'/',
	'/games',
	'/about',
	'/methodology',
	'/privacy',
	'/terms',
	'/community-rules',
	'/contact'
];
const escapeXml = (value: string) =>
	value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');

export function GET() {
	const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map((path) => `<url><loc>${escapeXml(absoluteUrl(path))}</loc></url>`).join('\n')}\n</urlset>`;
	return new Response(body, {
		headers: {
			'content-type': 'application/xml; charset=utf-8',
			'cache-control': 'public, max-age=3600'
		}
	});
}
