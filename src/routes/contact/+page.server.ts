import { PUBLIC_CONTACT_EMAIL } from '$app/env/private';
import type { PageServerLoad } from './$types';
import { absoluteUrl } from '#lib/server/seo.js';

export const load: PageServerLoad = () => ({
	contactEmail: PUBLIC_CONTACT_EMAIL || null,
	canonical: absoluteUrl('/contact')
});
