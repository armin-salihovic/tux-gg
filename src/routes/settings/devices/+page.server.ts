import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { PRIVATE_NO_STORE_CACHE_CONTROL } from '#lib/server/cache-policy.js';
import { isOwnerAdmin as hasOwnerAdminAccess } from '#lib/server/admin-access.js';
import { requireUser } from '#lib/server/authz.js';
import {
	deleteUserDevice,
	DeviceNotFoundError,
	listUserDevices,
	setDefaultUserDevice
} from '#lib/server/user-devices.js';

const idSchema = z.uuid();

export const load: PageServerLoad = async (event) => {
	const user = requireUser(event);
	event.setHeaders({ 'cache-control': PRIVATE_NO_STORE_CACHE_CONTROL });
	let devices;
	try {
		devices = await listUserDevices(user.id);
	} catch {
		error(503, 'Your devices are temporarily unavailable. Please try again.');
	}
	let isOwnerAdmin = false;
	try {
		isOwnerAdmin = await hasOwnerAdminAccess(event);
	} catch {
		// Keep the private Settings link hidden if the Steam account lookup fails.
	}
	return { devices, isOwnerAdmin, saved: event.url.searchParams.get('saved') === '1' };
};

export const actions: Actions = {
	setDefault: async (event) => {
		const user = requireUser(event);
		const form = await event.request.formData();
		const id = idSchema.safeParse(form.get('id'));
		if (!id.success) return fail(400, { error: 'Choose a valid device.' });
		try {
			await setDefaultUserDevice(user.id, id.data);
		} catch (cause) {
			if (cause instanceof DeviceNotFoundError) return fail(404, { error: 'Device not found.' });
			return fail(503, { error: 'The default device could not be updated. Please try again.' });
		}
		redirect(303, '/settings/devices?saved=1');
	},
	delete: async (event) => {
		const user = requireUser(event);
		const form = await event.request.formData();
		const id = idSchema.safeParse(form.get('id'));
		if (!id.success) return fail(400, { error: 'Choose a valid device.' });
		try {
			await deleteUserDevice(user.id, id.data);
		} catch (cause) {
			if (cause instanceof DeviceNotFoundError) return fail(404, { error: 'Device not found.' });
			return fail(503, { error: 'The device could not be deleted. Please try again.' });
		}
		redirect(303, '/settings/devices?saved=1');
	}
};
