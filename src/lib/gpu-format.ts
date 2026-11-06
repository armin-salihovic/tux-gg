const knownVendorNames: Record<string, RegExp> = {
	amd: /\b(?:amd|ati|radeon)\b/i,
	nvidia: /\b(?:nvidia|geforce|quadro)\b/i,
	intel: /\b(?:intel|arc(?:\s+a?\d+)?|iris|uhd graphics)\b/i
};

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function formatGpuName(
	vendor: string | null | undefined,
	gpu: string | null | undefined
): string {
	const name = gpu?.trim() || '';
	const label = vendor?.trim() || '';
	if (!label) return name;
	if (!name) return label;

	const vendorPattern = knownVendorNames[label.toLowerCase()];
	if (vendorPattern?.test(name)) return name;

	const exactVendorPattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(label)}(?=$|[^a-z0-9])`, 'i');
	return exactVendorPattern.test(name) ? name : `${label} ${name}`;
}
