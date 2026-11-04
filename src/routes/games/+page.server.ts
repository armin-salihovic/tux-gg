import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { PageServerLoad } from './$types';
import { getCatalog, type CatalogSort } from '#lib/server/db/queries.js';
import { absoluteUrl } from '#lib/server/seo.js';

const tierSchema = z.enum(['platinum', 'gold', 'silver', 'bronze', 'borked', 'unknown']);
const sortSchema = z.enum(['title', 'reports', 'recent', 'tier']);
const pageSchema = z.coerce.number().int().min(1).max(100_000).catch(1);

export const load: PageServerLoad = async ({ url, setHeaders }) => {
	const q = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
	const tierResult = tierSchema.safeParse(url.searchParams.get('tier'));
	const sortResult = sortSchema.safeParse(url.searchParams.get('sort') ?? 'title');
	const page = pageSchema.parse(url.searchParams.get('page') ?? '1');
	const tier = tierResult.success ? tierResult.data : undefined;
	const sort: CatalogSort = sortResult.success ? sortResult.data : 'title';
	const filtered = Boolean(q || tier || sort !== 'title' || page > 1);
	setHeaders({ 'cache-control': 'public, max-age=30, stale-while-revalidate=120' });
	if (url.searchParams.has('page') && page === 1 && url.searchParams.get('page') !== '1') {
		// Invalid pages are treated as page one without reflecting arbitrary input into SQL.
	}

	try {
		return {
			available: true,
			q,
			tier,
			sort,
			...(await getCatalog({ q, tier, sort, page })),
			filtered,
			canonical: absoluteUrl('/games')
		};
	} catch {
		return {
			available: false,
			q,
			tier,
			sort,
			games: [],
			total: 0,
			page: 1,
			pageSize: 24,
			pageCount: 1,
			filtered,
			canonical: absoluteUrl('/games')
		};
	}
};
