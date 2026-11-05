const WINDOW_MS = 60 * 60 * 1000;
const MAX_REPORTS_PER_WINDOW = 5;
const submissions = new Map<string, number[]>();
let lastCleanup = 0;

/** In-process per-account throttle; PostgreSQL remains the source of truth for stored reports. */
export function reserveNativeReportSubmission(userId: string, now = Date.now()): boolean {
	if (now - lastCleanup >= WINDOW_MS) {
		for (const [id, times] of submissions) {
			const current = times.filter((time) => now - time < WINDOW_MS);
			if (current.length) submissions.set(id, current);
			else submissions.delete(id);
		}
		lastCleanup = now;
	}
	const recent = (submissions.get(userId) ?? []).filter((time) => now - time < WINDOW_MS);
	if (recent.length >= MAX_REPORTS_PER_WINDOW) {
		submissions.set(userId, recent);
		return false;
	}
	recent.push(now);
	submissions.set(userId, recent);
	return true;
}

export function clearNativeReportRateLimitForTests(): void {
	submissions.clear();
}
