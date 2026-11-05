import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import type { SavedDeviceType } from '#lib/steam-system-info.js';
import { requireUser } from '#lib/server/authz.js';
import { PRIVATE_NO_STORE_CACHE_CONTROL } from '#lib/server/cache-policy.js';
import { getUserDevice, updateUserDevice, DeviceNotFoundError } from '#lib/server/user-devices.js';
import { parseDeviceForm } from '#lib/server/user-device-validation.js';

const idSchema = z.uuid();

function formValues(form: FormData) {
	return Object.fromEntries(
		[
			'name',
			'deviceType',
			'cpu',
			'gpu',
			'gpuVendor',
			'ram',
			'distribution',
			'kernel',
			'graphicsDriver',
			'gpuDriverDetail'
		].map((key) => [key, String(form.get(key) ?? '').slice(0, key === 'name' ? 60 : 160)])
	);
}

export const load: PageServerLoad = async (event) => {
	const user = requireUser(event);
	event.setHeaders({ 'cache-control': PRIVATE_NO_STORE_CACHE_CONTROL });
	if (!idSchema.safeParse(event.params.id).success) error(404, 'Device not found');
	const device = await getUserDevice(user.id, event.params.id);
	if (!device) error(404, 'Device not found');
	const {
		id,
		name,
		deviceType,
		cpu,
		gpu,
		gpuVendor,
		ram,
		distribution,
		kernel,
		graphicsDriver,
		gpuDriverDetail
	} = device;
	return {
		device: {
			id,
			name,
			deviceType: deviceType as SavedDeviceType,
			cpu,
			gpu,
			gpuVendor,
			ram,
			distribution,
			kernel,
			graphicsDriver,
			gpuDriverDetail
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
				formError: parsed.error.issues[0]?.message ?? 'Check the device details and try again.'
			});
		}
		try {
			await updateUserDevice(user.id, event.params.id, parsed.data);
		} catch (cause) {
			if (cause instanceof DeviceNotFoundError) error(404, 'Device not found');
			return fail(503, {
				values: formValues(form),
				formError: 'The device could not be saved. Please try again.'
			});
		}
		redirect(303, '/settings/devices?saved=1');
	}
};
