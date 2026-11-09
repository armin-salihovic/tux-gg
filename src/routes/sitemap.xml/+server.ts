import { absoluteUrl } from '#lib/server/seo.js';
import { getSitemapGames } from '#lib/server/db/queries.js';

const CHUNK_SIZE = 10_000;
const STATIC_PATHS = [
	'/',
	'/games',
	'/about',
	'/methodology',
	'/privacy',
	'/terms',
	'/community-rules',
	'/contact'
];

function escapeXml(value: string) {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

export async function GET() {
	let total = 0;
	try {
		total = (await getSitemapGames(0, 1)).total;
	} catch {
		/* A static sitemap remains useful while the DB is offline. */
	}
	const chunkCount = Math.ceil(total / CHUNK_SIZE);
	const body = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[
		`<sitemap><loc>${escapeXml(absoluteUrl('/sitemap-static.xml'))}</loc></sitemap>`,
		...Array.from(
			{ length: chunkCount },
			(_, index) =>
				`<sitemap><loc>${escapeXml(absoluteUrl(`/sitemap-games-${index}.xml`))}</loc></sitemap>`
		)
	].join('\n')}\n</sitemapindex>`;
	return new Response(body, {
		headers: {
			'content-type': 'application/xml; charset=utf-8',
			'cache-control': 'public, max-age=1800'
		}
	});
}
