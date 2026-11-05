const GAME_REPORT_PATH = /^\/games\/\d{1,20}\/[a-z0-9][a-z0-9-]{0,119}\/report\/new$/;

/** Return paths are limited to a local game-report form to prevent open redirects. */
export function safeDeviceReturnPath(value: string | null | undefined): string | null {
	if (!value || value.length > 300 || value.includes('\\') || /[\u0000-\u001f]/.test(value))
		return null;
	try {
		const parsed = new URL(value, 'https://tuxgg.invalid');
		if (parsed.origin !== 'https://tuxgg.invalid' || parsed.search || parsed.hash) return null;
		return GAME_REPORT_PATH.test(parsed.pathname) ? parsed.pathname : null;
	} catch {
		return null;
	}
}
