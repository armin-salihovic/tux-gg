/** Validate a local redirect destination before binding it to Steam login state. */
export function validateSameOriginReturnTo(value: unknown, origin: string): string | null {
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		value.length > 2048 ||
		!value.startsWith('/') ||
		value.startsWith('//') ||
		value.includes('\\') ||
		/[\u0000-\u001f\u007f]/.test(value) ||
		value.includes('#')
	) {
		return null;
	}

	try {
		const trustedOrigin = new URL(origin).origin;
		const target = new URL(value, trustedOrigin);
		if (target.origin !== trustedOrigin || target.username || target.password) return null;
		return `${target.pathname}${target.search}`;
	} catch {
		return null;
	}
}
