export const STEAM_SYSTEM_INFO_MAX_LENGTH = 256_000;

export type SavedDeviceType = 'linux_desktop' | 'steam_deck';

export interface DetectedSystemInfo {
	deviceType: SavedDeviceType;
	cpu: string;
	gpu: string;
	gpuVendor: 'AMD' | 'NVIDIA' | 'Intel' | null;
	ram: string | null;
	distribution: string | null;
	kernel: string | null;
	graphicsDriver: string | null;
	gpuDriverDetail: string | null;
	missingFields: string[];
}

export type SystemInfoErrorReason =
	| 'empty_input'
	| 'too_large'
	| 'malformed_structure'
	| 'unsupported_os'
	| 'unidentified_os'
	| 'missing_cpu'
	| 'missing_gpu';

export type SystemInfoParseResult =
	| { ok: true; value: DetectedSystemInfo }
	| { ok: false; reason: SystemInfoErrorReason; error: string };

type ParsedField = Exclude<keyof DetectedSystemInfo, 'deviceType' | 'missingFields'>;

function failure(reason: SystemInfoErrorReason, error: string): SystemInfoParseResult {
	return { ok: false, reason, error };
}

function clean(value: string | undefined): string | null {
	const result = value?.trim().replace(/\s+/g, ' ');
	return result || null;
}

function sectionLines(sections: Map<string, string[]>, name: string): string[] {
	return sections.get(name.toLowerCase()) ?? [];
}

function getField(lines: string[], ...names: string[]): string | null {
	const wanted = new Set(names.map((name) => name.toLowerCase()));
	for (const line of lines) {
		const match = /^\s*([^:]+):\s*(.*?)\s*$/.exec(line);
		if (match && wanted.has(match[1].toLowerCase())) return clean(match[2]);
	}
	return null;
}

function normalizeCpu(value: string | null): string | null {
	return (
		value?.replace(/\s+\d+[- ]core processor\s*$/i, '').replace(/\s+processor\s*$/i, '') ?? null
	);
}

const knownLinuxName =
	/\b(?:CachyOS|SteamOS(?:\s+Holo)?|Ubuntu|Pop!_OS|Linux Mint|Arch Linux|EndeavourOS|Manjaro(?:\s+Linux)?|Fedora(?:\s+Linux)?|Debian(?:\s+GNU\/Linux)?|Nobara(?:\s+Linux)?|Bazzite|openSUSE|Garuda Linux|NixOS|Gentoo|Alpine Linux|Void Linux|elementary OS|Zorin OS|KDE neon|Kubuntu|Xubuntu|Lubuntu|PCLinuxOS|MX Linux|Red Hat Enterprise Linux|Rocky Linux|AlmaLinux)\b/i;

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
		const known = knownLinuxName.exec(value);
		if (known) {
			const suffix = /^\s+\d+(?:\.\d+)*\b/.exec(value.slice(known.index + known[0].length));
			return `${known[0]}${suffix?.[0] ?? ''}`.replace(/\s+/g, ' ').trim().slice(0, 120);
		}
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
	if (unit === 'Mb' && amount >= 1024) return `${oneDecimal(amount / 1024)} GiB`;
	return raw.slice(0, 80);
}

function inferVendor(value: string): DetectedSystemInfo['gpuVendor'] {
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

function parseSections(input: string): Map<string, string[]> {
	const sections = new Map<string, string[]>();
	const recognizedHeading = (name: string) =>
		/^(?:computer information|processor information|operating system|memory|video card(?:\s*#?\d+)?)$/i.test(
			name.trim()
		);
	let current = '';
	for (const line of input.replace(/\r\n?/g, '\n').split('\n')) {
		const heading = /^\s*([^:]{1,80}):\s*$/.exec(line);
		if (heading && recognizedHeading(heading[1])) {
			current = heading[1].trim().toLowerCase();
			sections.set(current, sections.get(current) ?? []);
		} else if (current) {
			sections.get(current)!.push(line);
		}
	}
	return sections;
}

export function parseSteamSystemInfo(input: string): SystemInfoParseResult {
	if (typeof input !== 'string' || !input.trim()) {
		return failure('empty_input', 'Paste Steam System Information first.');
	}
	if (input.length > STEAM_SYSTEM_INFO_MAX_LENGTH) {
		return failure(
			'too_large',
			`System Information must be ${STEAM_SYSTEM_INFO_MAX_LENGTH.toLocaleString()} characters or fewer.`
		);
	}

	const sections = parseSections(input);
	const cpuSection = sectionLines(sections, 'processor information');
	const osSection = sectionLines(sections, 'operating system');
	const videoSection = [...sections.entries()]
		.filter(([name]) => /^video card(?:\s*#?\d+)?$/.test(name))
		.flatMap(([, lines]) => lines);
	const memorySection = sectionLines(sections, 'memory');
	const computerSection = sectionLines(sections, 'computer information');

	if (!cpuSection.length || !osSection.length || !videoSection.length) {
		return failure(
			'malformed_structure',
			'Paste the complete Steam System Information, including Operating System, Processor Information, and Video Card sections.'
		);
	}

	const osText = osSection.join('\n');
	if (/\bwindows\s*(?:10|11|7|8|8\.1)?\b|\bwin32\b|\bwin64\b/i.test(osText)) {
		return failure(
			'unsupported_os',
			'This system information appears to come from Windows. Only Linux PCs and Steam Decks can be added to VapourDB.'
		);
	}
	if (/\bmac\s*os(?:\s*x)?\b|\bmacos\b|\bos\s*x\b/i.test(osText)) {
		return failure(
			'unsupported_os',
			'This system information appears to come from macOS. Only Linux PCs and Steam Decks can be added to VapourDB.'
		);
	}

	const kernelName = getField(osSection, 'Kernel Name');
	const explicitLinux = Boolean(
		(kernelName && /^linux$/i.test(kernelName)) ||
		/\bLinux\b/i.test(osText) ||
		knownLinuxName.test(osText)
	);
	if (!explicitLinux) {
		return failure(
			'unidentified_os',
			'Unable to confirm that this device is running Linux or SteamOS. Please paste the complete Steam System Information.'
		);
	}

	const cpu = normalizeCpu(getField(cpuSection, 'CPU Brand', 'Processor Name', 'CPU'));
	if (!cpu) {
		return failure('missing_cpu', 'Steam System Information must include a CPU identification.');
	}
	const driverLine = getField(videoSection, 'Driver');
	const gpu = normalizeGpu(
		driverLine
			?.split('(')[0]
			?.replace(/^Driver:\s*/i, '')
			.trim() ?? getField(videoSection, 'GPU', 'Video Card', 'Name')
	);
	if (!gpu) {
		return failure('missing_gpu', 'Steam System Information must include a GPU identification.');
	}

	const manufacturer = getField(computerSection, 'Manufacturer') ?? '';
	const model = getField(computerSection, 'Model') ?? '';
	const deckModel = /\b(?:steam deck|jupiter|galileo)\b/i.test(model);
	const deckApu = /\bAMD Custom APU 040[56]\b/i.test(`${cpu} ${gpu}`);
	const steamDeck = Boolean(
		/\bSteamOS\b/i.test(osText) && /\bValve\b/i.test(manufacturer) && (deckModel || deckApu)
	);

	const versionLine = getField(videoSection, 'Driver Version', 'Graphics Driver Version');
	const mesa = versionLine?.match(/\bMesa\s+([^,;)]+)/i)?.[0]?.trim();
	const value: DetectedSystemInfo = {
		deviceType: steamDeck ? 'steam_deck' : 'linux_desktop',
		cpu,
		gpu,
		gpuVendor: inferVendor(gpu) ?? inferVendor(driverLine ?? ''),
		ram: normalizeRam(memorySection),
		distribution: findDistribution(osSection),
		kernel: getField(osSection, 'Kernel Version', 'Kernel')?.slice(0, 120) ?? null,
		graphicsDriver: (mesa ?? versionLine)?.slice(0, 120) ?? null,
		gpuDriverDetail:
			driverLine
				?.match(/\(([^,)]+)/)?.[1]
				?.trim()
				.slice(0, 120) ?? null,
		missingFields: []
	};
	const optionalFields: ParsedField[] = [
		'gpuVendor',
		'ram',
		'distribution',
		'kernel',
		'graphicsDriver',
		'gpuDriverDetail'
	];
	value.missingFields = optionalFields.filter((field) => value[field] === null);
	return { ok: true, value };
}
