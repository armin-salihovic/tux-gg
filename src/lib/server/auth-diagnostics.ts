type DiagnosticError = {
	name?: unknown;
	code?: unknown;
	cause?: unknown;
};

function safeErrorDetails(error: unknown): string {
	let current: unknown = error;
	let name = 'UnknownError';
	let code: string | undefined;
	for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
		const details = current as DiagnosticError;
		if (
			depth === 0 &&
			typeof details.name === 'string' &&
			/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(details.name)
		) {
			name = details.name;
		}
		if (typeof details.code === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(details.code)) {
			code = details.code;
		}
		if (!details.cause) break;
		current = details.cause;
	}
	return code ? `${name}, code=${code}` : name;
}

export function logAuthDiagnostic(component: string, error?: unknown): void {
	const details = error === undefined ? '' : ` (${safeErrorDetails(error)})`;
	console.error(`[auth] ${component} failed${details}.`);
}

export function logAuthRequestRejection(status: number): void {
	console.warn(`[auth] Steam login request validation returned HTTP ${status}.`);
}
