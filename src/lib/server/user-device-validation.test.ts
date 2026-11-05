import { describe, expect, it } from 'vitest';
import { userDeviceSchema } from './user-device-validation.js';

const valid = {
	name: '  Gaming PC  ',
	deviceType: 'linux_desktop',
	cpu: ' AMD Ryzen 7 9800X3D ',
	gpu: ' AMD Radeon RX 9070 XT ',
	gpuVendor: 'AMD',
	ram: '30.5 GB',
	distribution: 'CachyOS',
	kernel: '7.3',
	graphicsDriver: 'Mesa 26.2.6-arch3.1',
	gpuDriverDetail: 'radeonsi'
};

describe('saved device validation', () => {
	it('trims user text and accepts supported device types', () => {
		expect(userDeviceSchema.parse(valid)).toMatchObject({
			name: 'Gaming PC',
			cpu: 'AMD Ryzen 7 9800X3D',
			gpu: 'AMD Radeon RX 9070 XT'
		});
		expect(userDeviceSchema.safeParse({ ...valid, deviceType: 'steam_deck' }).success).toBe(true);
	});

	it('allows a useful partial device without inventing values', () => {
		expect(userDeviceSchema.parse({ name: 'Laptop', deviceType: 'linux_desktop' })).toMatchObject({
			cpu: null,
			gpu: null,
			gpuVendor: null,
			distribution: null
		});
	});

	it.each([
		{ name: '' },
		{ name: 'x'.repeat(61) },
		{ deviceType: 'windows_pc' },
		{ gpuVendor: 'UnknownVendor' },
		{ cpu: 'x'.repeat(161) }
	])('rejects invalid saved values %#', (override) => {
		expect(userDeviceSchema.safeParse({ ...valid, ...override }).success).toBe(false);
	});
});
