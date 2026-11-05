import { randomUUID } from 'node:crypto';
import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { nativeReportSchema } from '#lib/native-report-validation.js';
import { safeDeviceReturnPath } from '#lib/device-return-path.js';
import { canSubmitReports } from '#lib/server/authz.js';
import { getDb } from '#lib/server/db/db.js';
import { games } from '#lib/server/db/schema.js';
import { getGameById } from '#lib/server/db/queries.js';
import { PRIVATE_NO_STORE_CACHE_CONTROL } from '#lib/server/cache-policy.js';
import { logDatabaseFailure } from '#lib/server/database-errors.js';
import {
	releaseNativeReportSubmission,
	reserveNativeReportSubmission
} from '#lib/server/native-report-rate-limit.js';
import {
	insertNativeReportForDevice,
	SelectedDeviceNotFoundError
} from '#lib/server/native-reports.js';
import { listUserDevices } from '#lib/server/user-devices.js';

const appIdPattern = /^\d{1,20}$/;

function signInPath(returnTo: string): string {
	return `/login?returnTo=${encodeURIComponent(returnTo)}`;
}

function returnedValues(formData: FormData) {
	const limits: Record<string, number> = {
		id: 36,
		verdict: 16,
		deviceId: 36,
		content: 5001,
		protonVersion: 101,
		protonVariant: 101,
		customProtonVersion: 101,
		launchOptions: 1001,
		performanceNotes: 2001,
		knownIssues: 2001
	};
	return Object.fromEntries(
		Object.entries(limits).map(([key, limit]) => {
			const value = formData.get(key);
			return [key, typeof value === 'string' ? value.slice(0, limit) : ''];
		})
	);
}

export const load: PageServerLoad = async ({ params, locals, url, setHeaders }) => {
	setHeaders({ 'cache-control': PRIVATE_NO_STORE_CACHE_CONTROL });
	if (!appIdPattern.test(params.appId)) error(404, 'Game not found');
	let game;
	try {
		game = await getGameById(params.appId);
	} catch {
		error(503, 'Game data is temporarily unavailable.');
	}
	if (!game) error(404, 'Game not found');
	if (params.slug !== game.slug) redirect(308, `/games/${game.appId}/${game.slug}/report/new`);
	const returnTo = `${url.pathname}${url.search}`;
	if (!locals.user || !locals.session) redirect(303, signInPath(returnTo));
	if (!(await canSubmitReports(locals.user.id))) {
		error(403, 'A Steam-linked account is required to submit compatibility reports.');
	}
	let devices;
	try {
		devices = await listUserDevices(locals.user.id);
	} catch {
		error(503, 'Your saved devices are temporarily unavailable. Please try again.');
	}
	return {
		game,
		submissionId: randomUUID(),
		devices,
		returnTo: safeDeviceReturnPath(url.pathname) ?? `/games/${game.appId}/${game.slug}/report/new`
	};
};

export const actions: Actions = {
	default: async ({ request, params, locals, url }) => {
		const returnTo = `${url.pathname}${url.search}`;
		if (!locals.user || !locals.session) redirect(303, signInPath(returnTo));
		if (!(await canSubmitReports(locals.user.id))) {
			error(403, 'A Steam-linked account is required to submit compatibility reports.');
		}
		if (!appIdPattern.test(params.appId)) error(404, 'Game not found');

		const formData = await request.formData();
		const values = returnedValues(formData);
		const parsed = nativeReportSchema.safeParse(Object.fromEntries(formData));
		if (!parsed.success) {
			return fail(400, {
				values,
				errors: z.flattenError(parsed.error).fieldErrors,
				formError: 'Check the highlighted fields and try again.'
			});
		}

		let game: { appId: string; slug: string } | undefined;
		try {
			[game] = await getDb()
				.select({ appId: games.appId, slug: games.slug })
				.from(games)
				.where(eq(games.appId, params.appId))
				.limit(1);
		} catch {
			return fail(503, {
				values,
				formError: 'Game data is temporarily unavailable. Please try again.'
			});
		}
		if (!game) error(404, 'Game not found');
		if (game.slug !== params.slug) redirect(308, `/games/${game.appId}/${game.slug}/report/new`);
		const reservation = reserveNativeReportSubmission(locals.user.id);
		if (!reservation) {
			return fail(429, {
				values,
				formError: 'You have submitted several reports recently. Please try again later.'
			});
		}

		const report = parsed.data;
		try {
			await insertNativeReportForDevice(
				{
					id: report.id,
					appId: game.appId,
					authorId: locals.user.id,
					verdict: report.verdict,
					platform: 'linux_desktop',
					protonVersion: report.protonVersion,
					protonVariant: report.protonVariant,
					customProtonVersion: report.customProtonVersion,
					launchOptions: report.launchOptions,
					performanceNotes: report.performanceNotes,
					knownIssues: report.knownIssues,
					content: report.content
				},
				report.deviceId
			);
		} catch (cause) {
			releaseNativeReportSubmission(locals.user.id, reservation);
			if (cause instanceof SelectedDeviceNotFoundError) {
				return fail(400, {
					values,
					formError: 'Choose one of your saved devices before submitting the report.'
				});
			}
			if (
				typeof cause === 'object' &&
				cause !== null &&
				'code' in cause &&
				cause.code === '23505'
			) {
				return fail(409, {
					values,
					formError: 'This form was already submitted. Reload the page to start another report.'
				});
			}
			logDatabaseFailure('native report submission', cause);
			return fail(503, {
				values,
				formError: 'Your report could not be saved. Please try again shortly.'
			});
		}

		redirect(303, '/my-reports?submitted=1');
	}
};
