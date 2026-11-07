import type { PageServerLoad } from './$types';
import { getHomeData } from '#lib/server/db/queries.js';
import { absoluteUrl } from '#lib/server/seo.js';
import { logDatabaseFailure } from '#lib/server/database-errors.js';
import { PRIVATE_NO_STORE_CACHE_CONTROL } from '#lib/server/cache-policy.js';

export const load: PageServerLoad = async ({ setHeaders }) => {
	setHeaders({ 'cache-control': PRIVATE_NO_STORE_CACHE_CONTROL });
	try {
		return {
			available: true,
			...(await getHomeData()),
			canonical: absoluteUrl('/'),
			ogImage: absoluteUrl('/og-default.png')
		};
	} catch {
		logDatabaseFailure('homepage data query');
		return {
			available: false,
			popular: [],
			recent: [],
			totalGames: 0,
			totalReports: 0,
			canonical: absoluteUrl('/'),
			ogImage: absoluteUrl('/og-default.png')
		};
	}
};
