import type { PageServerLoad } from './$types';
import { validateSameOriginReturnTo } from '#lib/auth-return.js';

export const load: PageServerLoad = ({ url }) => ({
	returnTo: validateSameOriginReturnTo(url.searchParams.get('returnTo'), url.origin) ?? '/settings'
});
