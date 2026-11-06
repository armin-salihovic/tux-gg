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

Operating System:
CachyOS (64 bit)
Kernel Name: Linux
Kernel Version: 7.3

Video Card:
Driver: AMD AMD Radeon RX 9070 XT (radeonsi, gfx1201, ACO, DRM 3.64)
Driver Version: 4.6 (Compatibility Profile) Mesa 26.2.6-arch3.1

Memory:
RAM: 31188 Mb`;

function fixture(
	os: string,
	extraComputer = '',
	cpu = 'AMD Ryzen 5 7600',
	gpu = 'NVIDIA GeForce RTX 4060'
) {
	return `Computer Information:\n${extraComputer}\nProcessor Information:\nCPU Brand: ${cpu}\nOperating System:\n${os}\nVideo Card:\nDriver: ${gpu}\nMemory:\nRAM: 16 GB`;
}

describe('Steam System Information parser', () => {
	it('extracts CachyOS / Ryzen 9800X3D / RX 9070 XT and converts Steam RAM Mb to GiB', () => {
		const result = parseSteamSystemInfo(cachyFixture);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).toMatchObject({
			deviceType: 'linux_desktop',
			cpu: 'AMD Ryzen 7 9800X3D',
			gpu: 'AMD Radeon RX 9070 XT',
			gpuVendor: 'AMD',
			ram: '30.5 GiB',
			distribution: 'CachyOS',
			kernel: '7.3',
			graphicsDriver: 'Mesa 26.2.6-arch3.1',
			gpuDriverDetail: 'radeonsi',
			missingFields: []
		});
	});

	it.each(['Ubuntu 24.04', 'Fedora Linux 42', 'Arch Linux', 'Debian GNU/Linux 13'])(
		'recognizes %s as Linux',
		(os) => {
			const result = parseSteamSystemInfo(fixture(`${os} (64 bit)`));
			expect(result.ok && result.value.deviceType).toBe('linux_desktop');
		}
	);

	it('accepts a new distribution when Steam positively identifies the Linux kernel', () => {
		const result = parseSteamSystemInfo(
			fixture('Future Linux Distribution 2030 (64 bit)\nKernel Name: Linux')
		);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.distribution).toBe('Future Linux Distribution 2030');
	});

	it('recognizes Steam Deck LCD and OLED evidence and keeps generic SteamOS hardware a PC', () => {
		const lcd = fixture(
			'SteamOS Holo (64 bit)',
			'Manufacturer: Valve\nModel: Jupiter',
			'AMD Custom APU 0405',
			'AMD Custom GPU 0405 (RADV VANGOGH)'
		);
		const oled = fixture(
			'SteamOS Holo (64 bit)',
			'Manufacturer: Valve\nModel: Galileo',
			'AMD Custom APU 0406',
			'AMD Custom GPU 0406 (RADV VANGOGH)'
		);
		const generic = fixture(
			'SteamOS Holo (64 bit)\nKernel Name: Linux',
			'Manufacturer: Generic\nModel: Living Room PC'
		);
		expect(parseSteamSystemInfo(lcd)).toMatchObject({
			ok: true,
			value: { deviceType: 'steam_deck' }
		});
		expect(parseSteamSystemInfo(oled)).toMatchObject({
			ok: true,
			value: { deviceType: 'steam_deck' }
		});
		expect(parseSteamSystemInfo(generic)).toMatchObject({
			ok: true,
			value: { deviceType: 'linux_desktop' }
		});
	});

	it.each(['Windows 10 (64 bit)', 'Windows 11 (64 bit)', 'macOS 15'])('%s is rejected', (os) => {
		const result = parseSteamSystemInfo(fixture(os));
		expect(result).toMatchObject({ ok: false, reason: 'unsupported_os' });
	});

	it('does not classify missing or unknown OS evidence as Linux', () => {
		expect(parseSteamSystemInfo(fixture('UnknownOS 99'))).toMatchObject({
			ok: false,
			reason: 'unidentified_os'
		});
		expect(
			parseSteamSystemInfo(
				'Processor Information:\nCPU Brand: Intel Core i7\nVideo Card:\nDriver: NVIDIA GeForce RTX 4060'
			)
		).toMatchObject({ ok: false, reason: 'malformed_structure' });
	});

	it('requires recognized Steam sections and CPU and GPU identification', () => {
		expect(parseSteamSystemInfo('random words with a GPU')).toMatchObject({
			ok: false,
			reason: 'malformed_structure'
		});
		expect(parseSteamSystemInfo(fixture('Ubuntu', '', '', ''))).toMatchObject({
			ok: false,
			reason: 'missing_cpu'
		});
		expect(parseSteamSystemInfo(fixture('Ubuntu', '', 'AMD Ryzen 5 7600', ''))).toMatchObject({
			ok: false,
			reason: 'missing_gpu'
		});
	});

	it('handles Windows line endings, reordered fields, and graphics vendors', () => {
		const result = parseSteamSystemInfo(
			' Memory :\r\n RAM: 16 GB\r\nVideo Card:\r\n  Driver: NVIDIA GeForce RTX 4060\r\nOperating System:\r\nUbuntu 24.04 (64 bit)\r\nKernel Version: 6.8\r\nProcessor Information:\r\nCPU Brand: AMD Ryzen 5 7600 Processor'
		);
		expect(result).toMatchObject({
			ok: true,
			value: {
				cpu: 'AMD Ryzen 5 7600',
				gpuVendor: 'NVIDIA',
				ram: '16 GB',
				distribution: 'Ubuntu 24.04',
				kernel: '6.8'
			}
		});
	});

	it('keeps unknown GPU names without inventing a vendor and handles memory units', () => {
		const unknown = parseSteamSystemInfo(
			fixture('Ubuntu', '', 'Mystery CPU', 'Future Silicon Quantum GPU 9000')
		);
		expect(unknown).toMatchObject({
			ok: true,
			value: { gpu: 'Future Silicon Quantum GPU 9000', gpuVendor: null }
		});
		const parseRam = (value: string) => {
			const result = parseSteamSystemInfo(
				fixture(`Ubuntu\nKernel Name: Linux`).replace('RAM: 16 GB', `RAM: ${value}`)
			);
			return result.ok ? result.value.ram : null;
		};
		expect(parseRam('31188 MB')).toBe('29 GiB');
		expect(parseRam('16384 MiB')).toBe('16 GiB');
		expect(parseRam('32 GB')).toBe('32 GB');
		expect(parseRam('32 GiB')).toBe('32 GiB');
		expect(parseRam('16 Gb')).toBe('16 Gb');
	});

	it('rejects empty and oversized input with bounded diagnostics', () => {
		expect(parseSteamSystemInfo('  ')).toMatchObject({ ok: false, reason: 'empty_input' });
		expect(parseSteamSystemInfo('x'.repeat(STEAM_SYSTEM_INFO_MAX_LENGTH + 1))).toMatchObject({
			ok: false,
			reason: 'too_large'
		});
	});
});
