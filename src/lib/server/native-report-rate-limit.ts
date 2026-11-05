const WINDOW_MS = 60 * 60 * 1000;
const MAX_REPORTS_PER_WINDOW = 5;
type Reservation = { id: string; reservedAt: number };
const submissions = new Map<string, Reservation[]>();
let lastCleanup = 0;
let nextReservationId = 0;

/** In-process per-account throttle; PostgreSQL remains the source of truth for stored reports. */
export function reserveNativeReportSubmission(userId: string, now = Date.now()): string | null {
	if (now - lastCleanup >= WINDOW_MS) {
		for (const [id, reservations] of submissions) {
			const current = reservations.filter(({ reservedAt }) => now - reservedAt < WINDOW_MS);
			if (current.length) submissions.set(id, current);
			else submissions.delete(id);
		}
		lastCleanup = now;
	}
	const recent = (submissions.get(userId) ?? []).filter(
		({ reservedAt }) => now - reservedAt < WINDOW_MS
	);
	if (recent.length >= MAX_REPORTS_PER_WINDOW) {
		submissions.set(userId, recent);
		return null;
	}
	const reservationId = String(++nextReservationId);
	recent.push({ id: reservationId, reservedAt: now });
	submissions.set(userId, recent);
	return reservationId;
}

/** Return a failed database attempt's reservation without changing another request's quota. */
export function releaseNativeReportSubmission(userId: string, reservationId: string): void {
	const reservations = submissions.get(userId);
	if (!reservations) return;
	const remaining = reservations.filter(({ id }) => id !== reservationId);
	if (remaining.length) submissions.set(userId, remaining);
	else submissions.delete(userId);
}

export function clearNativeReportRateLimitForTests(): void {
	submissions.clear();
	nextReservationId = 0;
}
