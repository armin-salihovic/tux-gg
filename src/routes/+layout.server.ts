import type { LayoutServerLoad } from './$types';
import { absoluteUrl } from '#lib/server/seo.js';

export const load: LayoutServerLoad = ({ locals, url }) => ({
	user: locals.user,
	canonical: absoluteUrl(url.pathname)
});
