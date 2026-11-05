export function logDatabaseFailure(context: string): void {
	console.error(`[database] ${context} failed`);
}
