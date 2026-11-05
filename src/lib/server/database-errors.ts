export function logDatabaseFailure(context: string, cause?: unknown): void {
	const code =
		typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string'
			? cause.code
			: undefined;
	const postgresCode = code && /^[0-9A-Z]{5}$/.test(code) ? ` (PostgreSQL ${code})` : '';
	console.error(`[database] ${context} failed${postgresCode}`);
}
