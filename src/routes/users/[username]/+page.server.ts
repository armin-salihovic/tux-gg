import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { PageServerLoad } from './$types';
import { getProfile, getPublicUserReports } from '#lib/server/db/queries.js';
import { absoluteUrl } from '#lib/server/seo.js';
import { PRIVATE_NO_STORE_CACHE_CONTROL } from '#lib/server/cache-policy.js';
import { isValidUsername } from '#lib/usernames.js';

const pageSchema = z.coerce.number().int().min(1).max(10_000).catch(1);

export const load: PageServerLoad = async ({ params, url, setHeaders }) => {
	if (!isValidUsername(params.username)) error(404, 'Profile not found');
	setHeaders({ 'cache-control': PRIVATE_NO_STORE_CACHE_CONTROL });
	let profile;
	try {
		profile = await getProfile(params.username);
	} catch {
		error(503, 'Profiles are temporarily unavailable');
	}
	if (!profile) error(404, 'Profile not found');
	let reportData;
	try {
		reportData = await getPublicUserReports(
			profile.username,
			pageSchema.parse(url.searchParams.get('page') ?? '1')
		);
	} catch {
		error(503, 'Profiles are temporarily unavailable');
	}
	return { profile, reportData, canonical: absoluteUrl(`/users/${profile.username}`) };
};
