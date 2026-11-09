import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { isOwnerAdmin } from '#lib/server/admin-access.js';
import { requireUser } from '#lib/server/authz.js';
import { PRIVATE_NO_STORE_CACHE_CONTROL } from '#lib/server/cache-policy.js';
import { listRegisteredUsers, parseRegisteredUsersPage } from '#lib/server/registered-users.js';

export const load: PageServerLoad = async (event) => {
	event.setHeaders({
		'cache-control': PRIVATE_NO_STORE_CACHE_CONTROL,
		'x-robots-tag': 'noindex, nofollow'
	});
	requireUser(event);

	let authorized: boolean;
	try {
		authorized = await isOwnerAdmin(event);
	} catch {
		error(503, 'The registered users overview is temporarily unavailable. Please try again.');
	}
	if (!authorized) error(404, 'Not found.');

	try {
		return await listRegisteredUsers(parseRegisteredUsersPage(event.url.searchParams.get('page')));
	} catch {
		error(503, 'The registered users overview is temporarily unavailable. Please try again.');
	}
};
