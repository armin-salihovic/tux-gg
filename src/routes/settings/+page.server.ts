import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { requireUser } from '#lib/server/authz.js';
import { getSettingsProfile } from '#lib/server/db/queries.js';
import { getDb } from '#lib/server/db/db.js';
import { authUser } from '#lib/server/db/schema.js';
import { isOwnerAdmin as hasOwnerAdminAccess } from '#lib/server/admin-access.js';
import { eq } from 'drizzle-orm';

const profileSchema = z.object({
	name: z.string().trim().min(1).max(60),
	username: z
		.string()
		.trim()
		.toLowerCase()
		.min(3)
		.max(24)
		.regex(
			/^[a-z0-9][a-z0-9_-]*$/,
			'Use lowercase letters, numbers, underscores, and hyphens only.'
		)
});

export const load: PageServerLoad = async (event) => {
	const user = requireUser(event);
	const profile = await getSettingsProfile(user.id);
	if (!profile) redirect(303, '/login');
	let isOwnerAdmin = false;
	try {
		isOwnerAdmin = await hasOwnerAdminAccess(event);
	} catch {
		// The private link stays hidden if the persisted account lookup is unavailable.
	}
	return { profile, isOwnerAdmin, saved: event.url.searchParams.get('saved') === '1' };
};

export const actions: Actions = {
	profile: async (event) => {
		const user = requireUser(event);
		const form = await event.request.formData();
		const parsed = profileSchema.safeParse({
			name: form.get('name'),
			username: form.get('username')
		});
		if (!parsed.success)
			return fail(400, {
				error: parsed.error.issues[0]?.message ?? 'Please check the profile fields.'
			});
		try {
			await getDb()
				.update(authUser)
				.set({ ...parsed.data, updatedAt: new Date() })
				.where(eq(authUser.id, user.id));
		} catch {
			return fail(409, {
				error: 'That username may already be in use. Choose another and try again.'
			});
		}
		redirect(303, '/settings?saved=1');
	}
};
