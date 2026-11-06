import { describe, expect, it } from 'vitest';
import { parseDeviceForm } from './user-device-validation.js';

const steamInfo = `Processor Information:\nCPU Brand: AMD Ryzen 5 7600\nOperating System:\nUbuntu 24.04\nKernel Name: Linux\nVideo Card:\nDriver: AMD Radeon RX 7800 XT`;

describe('saved device form validation', () => {
	it('accepts only a friendly name and bounded Steam System Information', () => {
		const form = new FormData();
		form.set('name', '  Gaming PC  ');
		form.set('systemInfo', steamInfo);
		expect(parseDeviceForm(form)).toEqual({
			success: true,
			data: { name: 'Gaming PC', systemInfo: steamInfo }
		});
	});

	it('rejects client-supplied hardware and device type fields', () => {
		for (const key of [
			'deviceType',
			'cpu',
			'gpu',
			'gpuVendor',
			'ram',
			'distribution',
			'kernel',
			'graphicsDriver',
			'gpuDriverDetail'
		]) {
			const form = new FormData();
			form.set('name', 'Gaming PC');
			form.set('systemInfo', steamInfo);
			form.set(key, 'forged value');
			expect(parseDeviceForm(form)).toMatchObject({
				success: false,
				error: 'Hardware specifications can only be set from Steam System Information.'
			});
		}
	});

	it.each(['', 'x'.repeat(61)])('rejects invalid device names (%s)', (name) => {
		const form = new FormData();
		form.set('name', name);
		expect(parseDeviceForm(form).success).toBe(false);
	});
});
