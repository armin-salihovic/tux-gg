import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { parseSteamSystemInfo } from '#lib/steam-system-info.js';
import { safeDeviceReturnPath } from '#lib/device-return-path.js';
import { requireUser } from '#lib/server/authz.js';
import { PRIVATE_NO_STORE_CACHE_CONTROL } from '#lib/server/cache-policy.js';
import { getUserDevice, updateUserDevice, DeviceNotFoundError } from '#lib/server/user-devices.js';
import { parseDeviceForm } from '#lib/server/user-device-validation.js';

const idSchema = z.uuid();

function formValues(form: FormData) {
	return { name: String(form.get('name') ?? '').slice(0, 60) };
}

export const load: PageServerLoad = async (event) => {
	const user = requireUser(event);
	event.setHeaders({ 'cache-control': PRIVATE_NO_STORE_CACHE_CONTROL });
	if (!idSchema.safeParse(event.params.id).success) error(404, 'Device not found');
	const device = await getUserDevice(user.id, event.params.id);
	if (!device) error(404, 'Device not found');
	const { id, name, sourceVerifiedAt } = device;
	return {
		returnTo: safeDeviceReturnPath(event.url.searchParams.get('returnTo')) ?? '/settings/devices',
		device: {
			id,
			name,
			sourceVerifiedAt
		}
	};
};

export const actions: Actions = {
	save: async (event) => {
		const user = requireUser(event);
		if (!idSchema.safeParse(event.params.id).success) error(404, 'Device not found');
		const form = await event.request.formData();
		const parsed = parseDeviceForm(form);
		if (!parsed.success) {
			return fail(400, {
				values: formValues(form),
				formError: parsed.error
			});
		}
		let hardware;
		if (parsed.data.systemInfo.trim()) {
			hardware = parseSteamSystemInfo(parsed.data.systemInfo);
			if (!hardware.ok) {
				return fail(400, { values: formValues(form), formError: hardware.error });
			}
		}
		try {
			await updateUserDevice(user.id, event.params.id, parsed.data.name, hardware?.value);
		} catch (cause) {
			if (cause instanceof DeviceNotFoundError) error(404, 'Device not found');
			return fail(503, {
				values: formValues(form),
				formError: 'The device could not be saved. Please try again.'
			});
		}
		const returnTo = safeDeviceReturnPath(String(form.get('returnTo') ?? ''));
		redirect(303, returnTo ?? '/settings/devices?saved=1');
	}
};
