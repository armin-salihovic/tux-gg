import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { absoluteUrl } from '#lib/server/seo.js';
import { getSitemapGames } from '#lib/server/db/queries.js';

const CHUNK_SIZE = 10_000;
const escapeXml = (value: string) =>
	value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');

export const GET: RequestHandler = async ({ params }) => {
	if (!/^\d{1,3}$/.test(params.part)) error(404, 'Sitemap chunk not found');
	const part = Number(params.part);
	if (part > 999) error(404, 'Sitemap chunk not found');
	let page;
	try {
		page = await getSitemapGames(part * CHUNK_SIZE, CHUNK_SIZE);
	} catch {
		error(503, 'Game sitemap temporarily unavailable');
	}
	if (part * CHUNK_SIZE >= page.total) error(404, 'Sitemap chunk not found');
	const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${page.games.map((game) => `<url><loc>${escapeXml(absoluteUrl(`/games/${game.appId}/${game.slug}`))}</loc>${game.updatedAt ? `<lastmod>${game.updatedAt.toISOString()}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>`;
	return new Response(body, {
		headers: {
			'content-type': 'application/xml; charset=utf-8',
			'cache-control': 'public, max-age=1800'
		}
	});
};
