import { error, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { PageServerLoad } from './$types';
import { getMyNativeReports } from '#lib/server/db/queries.js';
import { PRIVATE_NO_STORE_CACHE_CONTROL } from '#lib/server/cache-policy.js';

const pageSchema = z.coerce.number().int().min(1).max(10_000).catch(1);

export const load: PageServerLoad = async ({ locals, url, setHeaders }) => {
	setHeaders({ 'cache-control': PRIVATE_NO_STORE_CACHE_CONTROL });
	if (!locals.user || !locals.session) {
		redirect(303, `/login?returnTo=${encodeURIComponent(`${url.pathname}${url.search}`)}`);
	}
	try {
		return {
			reportData: await getMyNativeReports(
				locals.user.id,
				pageSchema.parse(url.searchParams.get('page') ?? '1')
			),
			submitted: url.searchParams.get('submitted') === '1'
		};
	} catch {
		error(503, 'Your reports are temporarily unavailable. Please try again shortly.');
	}
};
