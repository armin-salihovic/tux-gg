import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { isOwnerAdmin } from '#lib/server/admin-access.js';
import { requireUser } from '#lib/server/authz.js';
import { PRIVATE_NO_STORE_CACHE_CONTROL } from '#lib/server/cache-policy.js';
import {
	listReportsForModeration,
	moderateNativeReport,
	parseReportModerationFilter,
	parseReportModerationPage
} from '#lib/server/report-moderation.js';

const reportIdSchema = z.uuid();
const stateSchema = z.enum(['pending', 'published', 'hidden', 'removed']);
const actionSchema = z.enum(['review', 'hide', 'remove', 'restore']);
const userIdSchema = z
	.string()
	.min(1)
	.max(128)
	.regex(/^[a-zA-Z0-9_-]+$/);

async function requireReportAdmin(event: RequestEvent) {
	requireUser(event);
	let authorized: boolean;
	try {
		authorized = await isOwnerAdmin(event);
	} catch {
		error(503, 'Report Moderation is temporarily unavailable. Please try again.');
	}
	if (!authorized) error(404, 'Not found.');
}

export const load: PageServerLoad = async (event) => {
	event.setHeaders({
		'cache-control': PRIVATE_NO_STORE_CACHE_CONTROL,
		'x-robots-tag': 'noindex, nofollow'
	});
	await requireReportAdmin(event);
	const filter = parseReportModerationFilter(event.url.searchParams.get('filter'));
	const userIdValue = event.url.searchParams.get('userId');
	const userId =
		userIdValue && userIdSchema.safeParse(userIdValue).success ? userIdValue : undefined;
	const search = event.url.searchParams.get('q')?.slice(0, 100) ?? '';
	try {
		const listing = await listReportsForModeration({
			filter,
			search,
			userId,
			page: parseReportModerationPage(event.url.searchParams.get('page'))
		});
		return { ...listing, filter, search, userId };
	} catch {
		error(503, 'Report Moderation is temporarily unavailable. Please try again.');
	}
};

export const actions: Actions = {
	moderate: async (event) => {
		event.setHeaders({
			'cache-control': PRIVATE_NO_STORE_CACHE_CONTROL,
			'x-robots-tag': 'noindex, nofollow'
		});
		await requireReportAdmin(event);
		const form = await event.request.formData();
		const id = reportIdSchema.safeParse(form.get('id'));
		const fromState = stateSchema.safeParse(form.get('expectedState'));
		const action = actionSchema.safeParse(form.get('action'));
		if (!id.success) return fail(400, { error: 'Choose a valid report.' });
		if (!fromState.success || !action.success) {
			return fail(400, { error: 'Choose a valid moderation action.' });
		}
		const confirmationRequired =
			action.data === 'remove' || (action.data === 'restore' && fromState.data === 'removed');
		if (confirmationRequired && form.get('confirm') !== 'yes') {
			return fail(400, { error: 'Confirm this report action before continuing.' });
		}
		let result: Awaited<ReturnType<typeof moderateNativeReport>>;
		try {
			result = await moderateNativeReport(id.data, fromState.data, action.data);
		} catch {
			return fail(503, { error: 'The report could not be updated. Please try again.' });
		}
		if (result === 'invalid')
			return fail(400, { error: 'That moderation transition is not allowed.' });
		if (result === 'missing') return fail(404, { error: 'Report not found.' });
		if (result === 'stale') {
			return fail(409, {
				error: 'This report changed since it was loaded. Refresh before moderating it.'
			});
		}
		const returnParams = new URLSearchParams(event.url.searchParams);
		returnParams.delete('/moderate');
		redirect(303, `${event.url.pathname}${returnParams.size ? `?${returnParams}` : ''}`);
	}
};
