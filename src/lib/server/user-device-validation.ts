import { z } from 'zod';
import { STEAM_SYSTEM_INFO_MAX_LENGTH } from '#lib/steam-system-info.js';

const deviceFormSchema = z.object({
	name: z.string().trim().min(1, 'Enter a name for this device.').max(60),
	systemInfo: z.string().max(STEAM_SYSTEM_INFO_MAX_LENGTH)
});

const hardwareFields = new Set([
	'deviceType',
	'cpu',
	'gpu',
	'gpuVendor',
	'ram',
	'distribution',
	'kernel',
	'graphicsDriver',
	'gpuDriverDetail'
]);

export type DeviceFormInput = z.infer<typeof deviceFormSchema>;
export type DeviceFormParseResult =
	{ success: true; data: DeviceFormInput } | { success: false; error: string };

/** Accept only a friendly label and transient Steam text; hardware values are always server-derived. */
export function parseDeviceForm(form: FormData): DeviceFormParseResult {
	if ([...form.keys()].some((key) => hardwareFields.has(key))) {
		return {
			success: false,
			error: 'Hardware specifications can only be set from Steam System Information.'
		};
	}
	const parsed = deviceFormSchema.safeParse({
		name: form.get('name'),
		systemInfo: form.get('systemInfo') ?? ''
	});
	if (!parsed.success) {
		return {
			success: false,
			error: parsed.error.issues[0]?.message ?? 'Check the device name and system information.'
		};
	}
	return { success: true, data: parsed.data };
}
