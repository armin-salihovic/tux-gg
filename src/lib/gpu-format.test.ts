import { describe, expect, it } from 'vitest';
import { formatGpuName } from './gpu-format.js';

describe('formatGpuName', () => {
	it.each([
		['AMD', 'AMD Radeon RX 9070 XT', 'AMD Radeon RX 9070 XT'],
		['AMD', 'Radeon RX 9070 XT', 'Radeon RX 9070 XT'],
		['NVIDIA', 'GeForce RTX 5090', 'GeForce RTX 5090'],
		['NVIDIA', 'NVIDIA GeForce RTX 5090', 'NVIDIA GeForce RTX 5090'],
		['Intel', 'Arc B580', 'Arc B580'],
		['Unknown Vendor', 'Unknown Vendor GPU 1', 'Unknown Vendor GPU 1'],
		['Unknown Vendor', 'Future GPU 1', 'Unknown Vendor Future GPU 1']
	])('formats %s and %s as %s', (vendor, gpu, expected) => {
		expect(formatGpuName(vendor, gpu)).toBe(expected);
	});

	it('shows a known vendor when the GPU name is missing', () => {
		expect(formatGpuName('AMD', null)).toBe('AMD');
	});

	it('preserves a GPU name when the vendor is missing', () => {
		expect(formatGpuName(null, 'Radeon RX 9070 XT')).toBe('Radeon RX 9070 XT');
	});

	it('handles an unknown vendor and missing GPU name', () => {
		expect(formatGpuName('Multiple', '')).toBe('Multiple');
		expect(formatGpuName(null, null)).toBe('');
	});
});
