export const STEAM_SYSTEM_INFO_MAX_LENGTH = 256_000;

export type SavedDeviceType = 'linux_desktop' | 'steam_deck';

export interface DetectedSystemInfo {
	deviceType: SavedDeviceType;
	cpu: string | null;
	gpu: string | null;
	gpuVendor: 'AMD' | 'NVIDIA' | 'Intel' | null;
	ram: string | null;
	distribution: string | null;
	kernel: string | null;
	graphicsDriver: string | null;
	gpuDriverDetail: string | null;
	missingFields: string[];
}

export type SystemInfoParseResult =
	{ ok: true; value: DetectedSystemInfo } | { ok: false; error: string };

const fieldNames: Array<keyof Omit<DetectedSystemInfo, 'deviceType' | 'missingFields'>> = [
	'cpu',
	'gpu',
	'gpuVendor',
	'ram',
	'distribution',
	'kernel',
	'graphicsDriver',
	'gpuDriverDetail'
];

function clean(value: string | undefined): string | null {
	const result = value?.trim().replace(/\s+/g, ' ');
	return result || null;
}

function getField(lines: string[], ...names: string[]): string | null {
	const wanted = new Set(names.map((name) => name.toLowerCase()));
	for (const line of lines) {
		const match = /^\s*([^:]+):\s*(.*?)\s*$/.exec(line);
		if (match && wanted.has(match[1].toLowerCase())) return clean(match[2]);
	}
	return null;
}

function getSection(sections: Map<string, string[]>, name: string): string[] {
	return sections.get(name.toLowerCase()) ?? [];
}

function normalizeCpu(value: string | null): string | null {
	return (
		value?.replace(/\s+\d+[- ]core processor\s*$/i, '').replace(/\s+processor\s*$/i, '') ?? null
	);
}

function findDistribution(lines: string[]): string | null {
	const keys = ['distribution', 'operating system', 'os'];
	for (const line of lines) {
		const keyValue = /^\s*([^:]+):\s*(.*?)\s*$/.exec(line);
		let value = keyValue
			? keys.includes(keyValue[1].toLowerCase())
				? keyValue[2]
				: ''
			: line.trim();
		if (!value) continue;
		value = value.replace(/\s*\((?:64|32)\s*bit\)\s*$/i, '').trim();
		if (!value || /^kernel\b|^glibc\b|^x window\b|^steam runtime\b/i.test(value)) continue;
		const distribution =
			/\b(CachyOS|SteamOS(?:\s+Holo)?|Ubuntu(?:\s+\d+(?:\.\d+){0,2})?|Pop!_OS(?:\s+\d+(?:\.\d+)*)?|Linux Mint(?:\s+\d+(?:\.\d+)*)?|Arch Linux|EndeavourOS|Manjaro(?:\s+Linux)?|Fedora(?: Linux)?(?:\s+\d+)?|Debian(?: GNU\/Linux)?(?:\s+\d+(?:\.\d+)*)?|Nobara(?: Linux)?(?:\s+\d+)?|Bazzite(?:\s+\d+(?:\.\d+)*)?|openSUSE(?: Leap| Tumbleweed)?(?:\s+\d+(?:\.\d+)*)?|Garuda Linux)\b/i.exec(
				value
			);
		if (distribution) return distribution[0].replace(/\s+/g, ' ').trim();
		// Steam's first unlabeled OS line is useful even when the distribution is new.
		if (!keyValue) return value.slice(0, 120);
	}
	return null;
}

function normalizeRam(lines: string[]): string | null {
	const raw = getField(lines, 'RAM', 'System Memory', 'Memory');
	if (!raw) return null;
	const match = /^(\d+(?:\.\d+)?)\s*(MiB|MB|Mb|GiB|GB|Gb|bytes?|B)$/.exec(raw);
	if (!match) return raw.slice(0, 80);
	const amount = Number(match[1]);
	const unit = match[2];
	if (!Number.isFinite(amount) || amount <= 0) return raw.slice(0, 80);
	const oneDecimal = (value: number) => String(Number(value.toFixed(1)));
	if (unit === 'GB') return `${oneDecimal(amount)} GB`;
	if (unit === 'GiB') return `${oneDecimal(amount)} GiB`;
	if (unit === 'MB') return `${oneDecimal((amount * 1_000_000) / 1_073_741_824)} GiB`;
	if (unit === 'MiB') return `${oneDecimal(amount / 1024)} GiB`;
	if (unit === 'bytes' || unit === 'byte' || unit === 'B') {
		return `${oneDecimal(amount / 1_073_741_824)} GiB`;
	}
	// Steam's Memory/RAM field conventionally labels its byte count "Mb" (for example, 31188 Mb).
	// Keep small counts and the distinct bit unit "Gb" unchanged when the intended quantity is unclear.
	if (unit === 'Mb' && amount >= 1024) return `${oneDecimal(amount / 1024)} GiB`;
	return raw.slice(0, 80);
}

function inferVendor(value: string | null): DetectedSystemInfo['gpuVendor'] {
	if (!value) return null;
	if (/\b(?:nvidia|geforce|quadro)\b/i.test(value)) return 'NVIDIA';
	if (/\b(?:amd|radeon|ati)\b/i.test(value)) return 'AMD';
	if (/\b(?:intel|arc\s+a\d|iris|uhd graphics)\b/i.test(value)) return 'Intel';
	return null;
}

function normalizeGpu(value: string | null): string | null {
	if (!value) return null;
	return value
		.replace(/^(AMD\s+){2,}/i, 'AMD ')
		.replace(/^(NVIDIA\s+){2,}/i, 'NVIDIA ')
		.replace(/^(Intel\s+){2,}/i, 'Intel ')
		.trim()
		.slice(0, 160);
}

export function parseSteamSystemInfo(input: string): SystemInfoParseResult {
	if (typeof input !== 'string' || !input.trim())
		return { ok: false, error: 'Paste Steam System Information first.' };
	if (input.length > STEAM_SYSTEM_INFO_MAX_LENGTH) {
		return {
			ok: false,
			error: `System Information must be ${STEAM_SYSTEM_INFO_MAX_LENGTH.toLocaleString()} characters or fewer.`
		};
	}

	const sections = new Map<string, string[]>();
	let current = '';
	for (const line of input.replace(/\r\n?/g, '\n').split('\n')) {
		const heading = /^\s*([^:]{1,80}):\s*$/.exec(line);
		if (heading) {
			current = heading[1].trim().toLowerCase();
			sections.set(current, sections.get(current) ?? []);
		} else if (current) {
			sections.get(current)!.push(line);
		}
	}

	const cpuSection = getSection(sections, 'processor information');
	const osSection = getSection(sections, 'operating system');
	const videoSection = [...sections.entries()]
		.filter(([name]) => /^video card(?:\s*#?\d+)?$/.test(name))
		.flatMap(([, lines]) => lines);
	const memorySection = getSection(sections, 'memory');
	const computerSection = getSection(sections, 'computer information');

	const cpu = normalizeCpu(getField(cpuSection, 'CPU Brand', 'Processor Name', 'CPU'));
	const driverLine = getField(videoSection, 'Driver');
	const gpu = normalizeGpu(
		driverLine
			?.split('(')[0]
			?.replace(/^Driver:\s*/i, '')
			.trim() ?? getField(videoSection, 'GPU', 'Video Card', 'Name')
	);
	const gpuVendor = inferVendor(gpu ?? driverLine);
	const versionLine = getField(videoSection, 'Driver Version', 'Graphics Driver Version');
	const mesa = versionLine?.match(/\bMesa\s+([^,;)]+)/i)?.[0]?.trim();
	const graphicsDriver = (mesa ?? versionLine)?.slice(0, 120) ?? null;
	const gpuDriverDetail =
		driverLine
			?.match(/\(([^,)]+)/)?.[1]
			?.trim()
			.slice(0, 120) ?? null;
	const distribution = findDistribution(osSection);
	const kernel = getField(osSection, 'Kernel Version', 'Kernel')?.slice(0, 120) ?? null;
	const ram = normalizeRam(memorySection);
	const manufacturer = getField(computerSection, 'Manufacturer') ?? '';
	const model = getField(computerSection, 'Model') ?? '';
	const deckModel = /\b(?:steam deck|jupiter|galileo)\b/i.test(model);
	const deckApu = /\bAMD Custom APU 0405\b|\bAMD Custom APU 0406\b/i.test(
		`${cpu ?? ''} ${gpu ?? ''}`
	);
	const steamDeck = Boolean(
		/\bSteamOS\b/i.test(osSection.join('\n')) &&
		/\bValve\b/i.test(manufacturer) &&
		(deckModel || deckApu)
	);
	const value: DetectedSystemInfo = {
		deviceType: steamDeck ? 'steam_deck' : 'linux_desktop',
		cpu,
		gpu,
		gpuVendor,
		ram,
		distribution,
		kernel,
		graphicsDriver,
		gpuDriverDetail,
		missingFields: []
	};
	value.missingFields = fieldNames.filter((field) => !value[field]);
	return { ok: true, value };
}
