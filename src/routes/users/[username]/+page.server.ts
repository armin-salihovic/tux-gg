import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getProfile } from '#lib/server/db/queries.js';
import { absoluteUrl } from '#lib/server/seo.js';

export const load: PageServerLoad = async ({ params, setHeaders }) => {
	if (!/^[a-z0-9][a-z0-9_-]{2,23}$/.test(params.username)) error(404, 'Profile not found');
	setHeaders({ 'cache-control': 'public, max-age=60, stale-while-revalidate=300' });
	let profile;
	try {
		profile = await getProfile(params.username);
	} catch {
		error(503, 'Profiles are temporarily unavailable');
	}
	if (!profile) error(404, 'Profile not found');
	return { profile, canonical: absoluteUrl(`/users/${profile.username}`) };
};
