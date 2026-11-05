import { z } from 'zod';

const nullableText = (max: number) =>
	z.preprocess(
		(value) => (value === '' || value === undefined ? null : value),
		z.string().trim().max(max).nullable()
	);

export const userDeviceSchema = z.object({
	name: z.string().trim().min(1, 'Enter a name for this device.').max(60),
	deviceType: z.enum(['linux_desktop', 'steam_deck']),
	cpu: nullableText(160),
	gpu: nullableText(160),
	gpuVendor: z.preprocess(
		(value) => (value === '' || value === undefined ? null : value),
		z.enum(['NVIDIA', 'AMD', 'Intel', 'Apple', 'Multiple', 'Unknown']).nullable()
	),
	ram: nullableText(80),
	distribution: nullableText(120),
	kernel: nullableText(120),
	graphicsDriver: nullableText(120),
	gpuDriverDetail: nullableText(120)
});

export type UserDeviceInput = z.infer<typeof userDeviceSchema>;

export function parseDeviceForm(form: FormData) {
	return userDeviceSchema.safeParse({
		name: form.get('name'),
		deviceType: form.get('deviceType'),
		cpu: form.get('cpu'),
		gpu: form.get('gpu'),
		gpuVendor: form.get('gpuVendor'),
		ram: form.get('ram'),
		distribution: form.get('distribution'),
		kernel: form.get('kernel'),
		graphicsDriver: form.get('graphicsDriver'),
		gpuDriverDetail: form.get('gpuDriverDetail')
	});
}
