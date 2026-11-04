import { PUBLIC_SITE_URL } from '$app/env/private';

export function absoluteUrl(path: string): string {
	const base = (PUBLIC_SITE_URL || 'http://localhost:5173').replace(/\/$/, '');
	return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export function plainDescription(value: string, max = 160): string {
	const normalized = value.replace(/\s+/g, ' ').trim();
	if (normalized.length <= max) return normalized;
	return `${normalized.slice(0, max - 1).trimEnd()}…`;
}
