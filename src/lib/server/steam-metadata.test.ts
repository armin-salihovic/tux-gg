import { describe, expect, it, vi } from 'vitest';
import {
	fetchSteamDetails,
	isSteamMetadataFresh,
	parseRetryAfter,
	planSteamMetadataSync,
	steamMetadataFetchedAt,
	waitForSteamRequestSlot
} from './steam-metadata.js';

describe('Steam metadata cache and request policy', () => {
	const now = Date.parse('2026-11-07T00:00:00.000Z');
	const fresh = { steam: { lastFetchedAt: new Date(now - 1000).toISOString() } };
	const stale = { steam: { lastFetchedAt: new Date(now - 31 * 86_400_000).toISOString() } };

	it('skips fresh game metadata and force-refreshes only on request', () => {
		const games = [
			{ app_id: '1', title: 'Fresh', metadata: fresh },
			{ app_id: '2', title: 'Stale', metadata: stale },
			{ app_id: '3', title: 'Never fetched', metadata: {} }
		];
		expect(planSteamMetadataSync(games, { now }).fetch.map((game) => game.app_id)).toEqual([
			'2',
			'3'
		]);
		expect(
			planSteamMetadataSync(games, { now, force: true }).fetch.map((game) => game.app_id)
		).toEqual(['1', '2', '3']);
		expect(isSteamMetadataFresh(fresh, now)).toBe(true);
		expect(isSteamMetadataFresh(stale, now)).toBe(false);
		expect(steamMetadataFetchedAt({ steam: { lastFetchedAt: 'invalid' } })).toBeNull();
	});

	it('waits until two seconds have passed before starting the next request', async () => {
		const wait = vi.fn(async (_ms: number) => undefined);
		let nowValue = 500;
		const scheduled = await waitForSteamRequestSlot(0, {
			now: () => nowValue,
			wait: async (ms) => {
				wait(ms);
				nowValue += ms;
			}
		});
		expect(wait).toHaveBeenCalledWith(1500);
		expect(scheduled).toBe(2000);
	});

	it('retries HTTP 429 using Retry-After and stops after a bounded number of attempts', async () => {
		const waits: number[] = [];
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '3' } }))
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ '440': { success: true, data: { name: 'Game' } } }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
			);
		const result = await fetchSteamDetails('440', {
			fetchImpl,
			wait: async (ms) => void waits.push(ms),
			now: () => now
		});
		expect(result).toEqual({ status: 'ok', data: { name: 'Game' } });
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(waits).toEqual([3000]);

		const deniedFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 403 }));
		expect(await fetchSteamDetails('440', { fetchImpl: deniedFetch })).toMatchObject({
			status: 'unavailable',
			code: 403
		});
		expect(deniedFetch).toHaveBeenCalledTimes(1);
	});

	it('parses Retry-After seconds and HTTP dates with a hard upper bound', () => {
		expect(parseRetryAfter('5', now)).toBe(5000);
		expect(parseRetryAfter(new Date(now + 10_000).toUTCString(), now)).toBe(10_000);
		expect(parseRetryAfter('invalid', now)).toBeNull();
		expect(parseRetryAfter('9999', now)).toBe(9_999_000);
	});

	it('bounds retries after network timeouts', async () => {
		const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('timeout'));
		const wait = vi.fn(async () => undefined);
		const result = await fetchSteamDetails('440', { fetchImpl, wait, timeoutMs: 1 });
		expect(result.status).toBe('unavailable');
		expect(fetchImpl).toHaveBeenCalledTimes(3);
		expect(wait).toHaveBeenCalledTimes(2);
	});
});
