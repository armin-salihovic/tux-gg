import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { parseSteamSystemInfo } from '#lib/steam-system-info.js';
import { safeDeviceReturnPath } from '#lib/device-return-path.js';
import { requireUser } from '#lib/server/authz.js';
import { PRIVATE_NO_STORE_CACHE_CONTROL } from '#lib/server/cache-policy.js';
import { createUserDevice, DeviceLimitError, MAX_USER_DEVICES } from '#lib/server/user-devices.js';
import { parseDeviceForm } from '#lib/server/user-device-validation.js';

function formValues(form: FormData) {
	return { name: String(form.get('name') ?? '').slice(0, 60) };
}

export const load: PageServerLoad = (event) => {
	requireUser(event);
	event.setHeaders({ 'cache-control': PRIVATE_NO_STORE_CACHE_CONTROL });
	return {
		returnTo: safeDeviceReturnPath(event.url.searchParams.get('returnTo')) ?? '/settings/devices'
	};
};

export const actions: Actions = {
	save: async (event) => {
		const user = requireUser(event);
		const form = await event.request.formData();
		const parsed = parseDeviceForm(form);
		if (!parsed.success) {
			return fail(400, {
				values: formValues(form),
				formError: parsed.error
			});
		}
		const hardware = parseSteamSystemInfo(parsed.data.systemInfo);
		if (!hardware.ok) {
			return fail(400, { values: formValues(form), formError: hardware.error });
		}
		try {
			await createUserDevice(user.id, parsed.data.name, hardware.value);
		} catch (cause) {
			if (cause instanceof DeviceLimitError) {
				return fail(400, {
					values: formValues(form),
					formError: `You can save up to ${MAX_USER_DEVICES} devices.`
				});
			}
			return fail(503, {
				values: formValues(form),
				formError: 'The device could not be saved. Please try again.'
			});
		}
		const returnTo = safeDeviceReturnPath(String(form.get('returnTo') ?? ''));
		redirect(303, returnTo ?? '/settings/devices?saved=1');
	}
};
