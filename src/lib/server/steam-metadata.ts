export const STEAM_METADATA_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const STEAM_MIN_REQUEST_INTERVAL_MS = 2000;
const MAX_ATTEMPTS = 3;
const MAX_RETRY_AFTER_MS = 120_000;

export interface SteamGameCache {
	app_id: string;
	title: string | null;
	metadata: unknown;
}

export function steamMetadataFetchedAt(metadata: unknown): Date | null {
	if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
	const steam = (metadata as Record<string, unknown>).steam;
	if (!steam || typeof steam !== 'object' || Array.isArray(steam)) return null;
	const value = (steam as Record<string, unknown>).lastFetchedAt;
	if (typeof value !== 'string') return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

export function isSteamMetadataFresh(
	metadata: unknown,
	now = Date.now(),
	ttlMs = STEAM_METADATA_TTL_MS
): boolean {
	const fetchedAt = steamMetadataFetchedAt(metadata);
	return fetchedAt !== null && now - fetchedAt.getTime() < ttlMs;
}

export function planSteamMetadataSync(
	games: readonly SteamGameCache[],
	options: { force?: boolean; now?: number } = {}
) {
	const now = options.now ?? Date.now();
	const cached = options.force
		? []
		: games.filter((game) => isSteamMetadataFresh(game.metadata, now));
	const cachedIds = new Set(cached.map((game) => game.app_id));
	return {
		cached,
		fetch: games.filter((game) => !cachedIds.has(game.app_id))
	};
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
	if (!value?.trim()) return null;
	const seconds = Number(value);
	const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
	if (!Number.isFinite(delay) || delay < 0) return null;
	return delay;
}

export async function waitForSteamRequestSlot(
	lastRequestAt: number | null,
	options: { now?: () => number; wait?: (ms: number) => Promise<void> } = {}
): Promise<number> {
	const now = options.now ?? Date.now;
	const wait = options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
	const requestAt = now();
	if (lastRequestAt !== null) {
		const remaining = STEAM_MIN_REQUEST_INTERVAL_MS - (requestAt - lastRequestAt);
		if (remaining > 0) await wait(remaining);
		return Math.max(requestAt, lastRequestAt + STEAM_MIN_REQUEST_INTERVAL_MS);
	}
	return requestAt;
}

export interface SteamDetailsResult {
	status: 'ok' | 'unavailable';
	data: Record<string, unknown> | null;
	code?: number;
}

export async function fetchSteamDetails(
	appId: string,
	options: {
		fetchImpl?: typeof fetch;
		wait?: (ms: number) => Promise<void>;
		now?: () => number;
		timeoutMs?: number;
	} = {}
): Promise<SteamDetailsResult> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const wait = options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
	const now = options.now ?? Date.now;
	const url = new URL('https://store.steampowered.com/api/appdetails');
	url.searchParams.set('appids', appId);
	url.searchParams.set('l', 'english');
	url.searchParams.set('cc', 'us');
	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
		try {
			const response = await fetchImpl(url, {
				signal: controller.signal,
				headers: { 'user-agent': 'VapourDB Steam catalog sync (development)' }
			});
			if (response.status === 403) return { status: 'unavailable', data: null, code: 403 };
			const retryable = response.status === 429 || response.status >= 500;
			if (!response.ok && !retryable) {
				return { status: 'unavailable', data: null, code: response.status };
			}
			if (retryable) {
				if (attempt + 1 >= MAX_ATTEMPTS) {
					return { status: 'unavailable', data: null, code: response.status };
				}
				const retryAfter =
					response.status === 429
						? parseRetryAfter(response.headers.get('retry-after'), now())
						: null;
				if (retryAfter !== null && retryAfter > MAX_RETRY_AFTER_MS) {
					return { status: 'unavailable', data: null, code: response.status };
				}
				await wait(Math.max(retryAfter ?? 0, 2000 * 2 ** attempt));
				continue;
			}
			const payload = (await response.json()) as Record<
				string,
				{ success?: boolean; data?: unknown }
			>;
			const item = payload?.[appId];
			if (!item?.success || !item.data || typeof item.data !== 'object') {
				return { status: 'unavailable', data: null };
			}
			return { status: 'ok', data: item.data as Record<string, unknown> };
		} catch (error) {
			if (attempt + 1 >= MAX_ATTEMPTS) return { status: 'unavailable', data: null };
			await wait(2000 * 2 ** attempt);
		} finally {
			clearTimeout(timeout);
		}
	}
	return { status: 'unavailable', data: null };
}
