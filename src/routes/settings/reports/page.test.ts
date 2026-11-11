import { beforeEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({
	isOwnerAdmin: vi.fn(),
	listReportsForModeration: vi.fn(),
	moderateNativeReport: vi.fn()
}));

vi.mock('#lib/server/admin-access.js', () => ({ isOwnerAdmin: dependencies.isOwnerAdmin }));
vi.mock('#lib/server/report-moderation.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('#lib/server/report-moderation.js')>();
	return {
		...actual,
		listReportsForModeration: dependencies.listReportsForModeration,
		moderateNativeReport: dependencies.moderateNativeReport
	};
});

import { actions, load } from './+page.server.js';

function makeEvent(
	url = 'https://vapourdb.test/settings/reports',
	formValues: Record<string, string> = {},
	guest = false
) {
	const responseHeaders: Record<string, string> = {};
	const body = new FormData();
	for (const [key, value] of Object.entries(formValues)) body.set(key, value);
	return {
		locals: guest
			? { user: null, session: null }
			: { user: { id: 'session-user' }, session: { id: 'active' } },
		url: new URL(url),
		request: { formData: async () => body },
		setHeaders(headers: Record<string, string>) {
			Object.assign(responseHeaders, headers);
		},
		responseHeaders
	} as unknown as Parameters<typeof load>[0] & { responseHeaders: Record<string, string> };
}

const validForm = {
	id: '11111111-1111-4111-8111-111111111111',
	expectedState: 'pending',
	action: 'review'
};

describe('private report moderation route', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		dependencies.isOwnerAdmin.mockResolvedValue(false);
		dependencies.listReportsForModeration.mockResolvedValue({
			reports: [],
			counts: { pending: 0, published: 0, hidden: 0, removed: 0 },
			total: 0,
			page: 1,
			pageSize: 25,
			pageCount: 1
		});
		dependencies.moderateNativeReport.mockResolvedValue('updated');
	});

	it('redirects guests before checking admin access or reading reports', async () => {
		const event = makeEvent(undefined, {}, true);
		await expect(load(event)).rejects.toMatchObject({ status: 303, location: '/login' });
		expect(dependencies.isOwnerAdmin).not.toHaveBeenCalled();
		expect(dependencies.listReportsForModeration).not.toHaveBeenCalled();
		expect(event.responseHeaders).toEqual({
			'cache-control': 'private, no-store',
			'x-robots-tag': 'noindex, nofollow'
		});
	});

	it('returns a non-disclosing 404 for non-admin loads and handcrafted POSTs', async () => {
		await expect(load(makeEvent())).rejects.toMatchObject({ status: 404 });
		await expect(actions.moderate(makeEvent(undefined, validForm))).rejects.toMatchObject({
			status: 404
		});
		expect(dependencies.listReportsForModeration).not.toHaveBeenCalled();
		expect(dependencies.moderateNativeReport).not.toHaveBeenCalled();
	});

	it('requires a signed-in allowlisted Steam admin for each load and action', async () => {
		dependencies.isOwnerAdmin.mockResolvedValue(true);
		const event = makeEvent(
			'https://vapourdb.test/settings/reports?filter=all&q=730&userId=user-7&page=2'
		);
		const data = await load(event);
		expect(data).toMatchObject({ filter: 'all', search: '730', userId: 'user-7' });
		expect(dependencies.listReportsForModeration).toHaveBeenCalledWith({
			filter: 'all',
			search: '730',
			userId: 'user-7',
			page: 2
		});
		const actionEvent = makeEvent(
			'https://vapourdb.test/settings/reports?filter=all&page=2',
			validForm
		);
		await expect(actions.moderate(actionEvent)).rejects.toMatchObject({
			status: 303,
			location: '/settings/reports?filter=all&page=2'
		});
		expect(dependencies.isOwnerAdmin).toHaveBeenCalledTimes(2);
		expect(dependencies.moderateNativeReport).toHaveBeenCalledWith(
			validForm.id,
			'pending',
			'review'
		);
	});

	it('requires explicit removal and removed-report restoration confirmation', async () => {
		dependencies.isOwnerAdmin.mockResolvedValue(true);
		const removal = await actions.moderate(
			makeEvent(undefined, { ...validForm, action: 'remove' })
		);
		expect(removal).toMatchObject({ status: 400 });
		const restore = await actions.moderate(
			makeEvent(undefined, { ...validForm, expectedState: 'removed', action: 'restore' })
		);
		expect(restore).toMatchObject({ status: 400 });
		expect(dependencies.moderateNativeReport).not.toHaveBeenCalled();
	});

	it('validates UUIDs and reports stale, missing, invalid, and failed updates without leaking database errors', async () => {
		dependencies.isOwnerAdmin.mockResolvedValue(true);
		expect(
			await actions.moderate(makeEvent(undefined, { ...validForm, id: 'not-a-uuid' }))
		).toMatchObject({ status: 400 });
		dependencies.moderateNativeReport.mockResolvedValueOnce('stale');
		expect(await actions.moderate(makeEvent(undefined, validForm))).toMatchObject({ status: 409 });
		dependencies.moderateNativeReport.mockResolvedValueOnce('missing');
		expect(await actions.moderate(makeEvent(undefined, validForm))).toMatchObject({ status: 404 });
		dependencies.moderateNativeReport.mockResolvedValueOnce('invalid');
		expect(await actions.moderate(makeEvent(undefined, validForm))).toMatchObject({ status: 400 });
		dependencies.moderateNativeReport.mockRejectedValueOnce(new Error('private DB details'));
		const failed = await actions.moderate(makeEvent(undefined, validForm));
		expect(failed).toMatchObject({ status: 503 });
		expect(JSON.stringify(failed)).not.toContain('private DB details');
	});

	it('uses safe defaults for invalid filters and does not accept request fields as admin grants', async () => {
		dependencies.isOwnerAdmin.mockResolvedValue(true);
		await load(
			makeEvent('https://vapourdb.test/settings/reports?filter=unknown&steamId=76561198129252229')
		);
		expect(dependencies.listReportsForModeration).toHaveBeenCalledWith({
			filter: 'pending',
			search: '',
			userId: undefined,
			page: 1
		});
	});
});
