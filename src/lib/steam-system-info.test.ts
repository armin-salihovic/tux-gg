import { describe, expect, it } from 'vitest';
import { parseSteamSystemInfo, STEAM_SYSTEM_INFO_MAX_LENGTH } from './steam-system-info.js';

const cachyFixture = `Computer Information:
Manufacturer: Gigabyte Technology Co., Ltd.
Model: B850M DS3H
Form Factor: Desktop

Processor Information:
CPU Vendor: AuthenticAMD
CPU Brand: AMD Ryzen 7 9800X3D 8-Core Processor
Speed: 5271 MHz
16 logical processors
8 physical processors

Operating System:
CachyOS (64 bit)
Kernel Name: Linux
Kernel Version: 7.3
glibc Version: 2.44
X Window Manager: KWin
Steam Runtime Version: steam-runtime_1.0.20261021.266054

Video Card:
Driver: AMD AMD Radeon RX 9070 XT (radeonsi, gfx1201, ACO, DRM 3.64, 7.3.1-1-cachyos)
Driver Version: 4.6 (Compatibility Profile) Mesa 26.2.6-arch3.1
OpenGL Version: 4.6
VendorID: 0x1002
DeviceID: 0x13c0
Primary Display Resolution: 2560 x 1440
Primary VRAM: 16384 MB

Memory:
RAM: 31188 Mb`;

describe('Steam System Information parser', () => {
	it('extracts the supplied CachyOS desktop fixture and converts Steam RAM Mb as megabytes', () => {
		const result = parseSteamSystemInfo(cachyFixture);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).toMatchObject({
			deviceType: 'linux_desktop',
			cpu: 'AMD Ryzen 7 9800X3D',
			gpu: 'AMD Radeon RX 9070 XT',
			gpuVendor: 'AMD',
			ram: '30.5 GB',
			distribution: 'CachyOS',
			kernel: '7.3',
			graphicsDriver: 'Mesa 26.2.6-arch3.1',
			gpuDriverDetail: 'radeonsi',
			missingFields: []
		});
	});

	it('recognizes supported Steam Deck evidence and does not over-classify Valve hardware', () => {
		const deck = parseSteamSystemInfo(
			`Computer Information:\nManufacturer: Valve\nModel: Jupiter\nOperating System:\nSteamOS Holo (64 bit)\nKernel Version: 6.5\nProcessor Information:\nCPU Brand: AMD Custom APU 0405\nVideo Card:\nDriver: AMD AMD Custom GPU 0405 (RADV VANGOGH)\nMemory:\nRAM: 16384 Mb`
		);
		expect(deck.ok && deck.value.deviceType).toBe('steam_deck');
		const genericValve = parseSteamSystemInfo(
			`Computer Information:\nManufacturer: Valve\nModel: Other PC\nOperating System:\nSteamOS Holo (64 bit)`
		);
		expect(genericValve.ok && genericValve.value.deviceType).toBe('linux_desktop');
	});

	it('recognizes NVIDIA and Intel GPUs and preserves unknown hardware labels', () => {
		const nvidia = parseSteamSystemInfo(
			'Video Card:\nDriver: NVIDIA GeForce RTX 5090\nDriver Version: 575.57'
		);
		const intel = parseSteamSystemInfo('Video Card:\nDriver: Intel Arc B580 Graphics');
		const unknown = parseSteamSystemInfo('Video Card:\nDriver: Future Silicon Quantum GPU 9000');
		expect(nvidia.ok && nvidia.value.gpuVendor).toBe('NVIDIA');
		expect(intel.ok && intel.value.gpuVendor).toBe('Intel');
		expect(unknown.ok && unknown.value.gpu).toBe('Future Silicon Quantum GPU 9000');
		expect(unknown.ok && unknown.value.gpuVendor).toBeNull();
	});

	it('handles reordered sections, whitespace, and Windows line endings', () => {
		const result = parseSteamSystemInfo(
			' Memory :\r\n RAM: 16 GB\r\nVideo Card:\r\n  Driver: NVIDIA GeForce RTX 4060\r\nOperating System:\r\nUbuntu 24.04 (64 bit)\r\nKernel Version: 6.8\r\nProcessor Information:\r\nCPU Brand: AMD Ryzen 5 7600 Processor'
		);
		expect(result.ok).toBe(true);
		if (result.ok)
			expect(result.value).toMatchObject({
				cpu: 'AMD Ryzen 5 7600',
				gpuVendor: 'NVIDIA',
				ram: '16 GB',
				distribution: 'Ubuntu 24.04',
				kernel: '6.8'
			});
	});

	it('returns partial values and names missing fields without guessing', () => {
		const result = parseSteamSystemInfo(
			'Operating System:\nUnlistedOS 99\nOther section:\nCPU: Mystery chip'
		);
		expect(result.ok).toBe(true);
		if (result.ok)
			expect(result.value).toMatchObject({
				cpu: null,
				gpu: null,
				ram: null,
				distribution: 'UnlistedOS 99',
				missingFields: expect.arrayContaining(['cpu', 'gpu', 'gpuVendor', 'ram', 'kernel'])
			});
	});

	it('ignores malformed lines and key/value pairs in unrelated sections', () => {
		const result = parseSteamSystemInfo(
			'Broken heading:\nCPU Brand: not a processor section\nVideo Card:\nDriver without a colon'
		);
		expect(result.ok).toBe(true);
		if (result.ok)
			expect(result.value).toMatchObject({
				cpu: null,
				gpu: null,
				gpuVendor: null,
				graphicsDriver: null
			});
	});

	it('preserves ambiguous small Mb values and rejects empty or oversized input', () => {
		const ambiguous = parseSteamSystemInfo('Memory:\nRAM: 512 Mb');
		expect(ambiguous.ok && ambiguous.value.ram).toBe('512 Mb');
		expect(parseSteamSystemInfo('  ').ok).toBe(false);
		expect(parseSteamSystemInfo('x'.repeat(STEAM_SYSTEM_INFO_MAX_LENGTH + 1))).toMatchObject({
			ok: false
		});
	});
});
