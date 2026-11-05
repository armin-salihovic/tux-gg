import type { PageServerLoad } from './$types';
import { getHomeData } from '#lib/server/db/queries.js';
import { absoluteUrl } from '#lib/server/seo.js';

export const load: PageServerLoad = async ({ setHeaders }) => {
	setHeaders({ 'cache-control': 'private, max-age=60' });
	try {
		return {
			available: true,
			...(await getHomeData()),
			canonical: absoluteUrl('/'),
			ogImage: absoluteUrl('/og-default.svg')
		};
	} catch {
		return {
			available: false,
			popular: [],
			recent: [],
			tiers: {},
			totalGames: 0,
			totalReports: 0,
			canonical: absoluteUrl('/'),
			ogImage: absoluteUrl('/og-default.svg')
		};
	}
};
