import { NODE_ENV, PUBLIC_SITE_URL } from '$app/env/private';

function siteOrigin(): string {
	if (!PUBLIC_SITE_URL) {
		if (NODE_ENV === 'production') {
			throw new Error('PUBLIC_SITE_URL must be configured to generate production canonical URLs.');
		}
		return 'http://localhost';
	}
	const parsed = new URL(PUBLIC_SITE_URL);
	if (
		parsed.pathname !== '/' ||
		parsed.search ||
		parsed.hash ||
		(NODE_ENV === 'production' && parsed.protocol !== 'https:')
	) {
		throw new Error('PUBLIC_SITE_URL must be an HTTPS origin in production and contain no path.');
	}
	return parsed.origin;
}

export function absoluteUrl(path: string): string {
	return `${siteOrigin()}${path.startsWith('/') ? path : `/${path}`}`;
}

export function plainDescription(value: string, max = 160): string {
	const normalized = value.replace(/\s+/g, ' ').trim();
	if (normalized.length <= max) return normalized;
	return `${normalized.slice(0, max - 1).trimEnd()}…`;
}
