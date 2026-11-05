import { error, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { PageServerLoad } from './$types';
import {
	getGameById,
	getGameReportFilters,
	getGameReports,
	getPublishedNativeReports
} from '#lib/server/db/queries.js';
import { absoluteUrl, plainDescription } from '#lib/server/seo.js';
import { logDatabaseFailure } from '#lib/server/database-errors.js';
import { PRIVATE_NO_STORE_CACHE_CONTROL } from '#lib/server/cache-policy.js';

const pageSchema = z.coerce.number().int().min(1).max(100_000).catch(1);
const communityPageSchema = z.coerce.number().int().min(1).max(10_000).catch(1);
const dateSchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/)
	.optional();

export const load: PageServerLoad = async ({ params, url, setHeaders }) => {
	if (!/^\d{1,20}$/.test(params.appId)) error(404, 'Game not found');
	const page = pageSchema.parse(url.searchParams.get('page') ?? '1');
	const gpuVendor = url.searchParams.get('gpu')?.slice(0, 40) || undefined;
	const distribution = url.searchParams.get('distribution')?.slice(0, 120) || undefined;
	const proton = url.searchParams.get('proton')?.slice(0, 160) || undefined;
	const verdictRaw = url.searchParams.get('verdict');
	const verdict = verdictRaw === 'yes' || verdictRaw === 'no' ? verdictRaw : undefined;
	const sinceResult = dateSchema.safeParse(url.searchParams.get('since') ?? undefined);
	const untilResult = dateSchema.safeParse(url.searchParams.get('until') ?? undefined);
	const since =
		sinceResult.success && sinceResult.data
			? new Date(`${sinceResult.data}T00:00:00.000Z`)
			: undefined;
	const until =
		untilResult.success && untilResult.data
			? new Date(`${untilResult.data}T00:00:00.000Z`)
			: undefined;
	const validSince = since && !Number.isNaN(since.valueOf()) ? since : undefined;
	const validUntil =
		until && !Number.isNaN(until.valueOf()) ? new Date(until.valueOf() + 86_400_000) : undefined;
	const filtered =
		['gpu', 'distribution', 'proton', 'verdict', 'since', 'until'].some((key) =>
			url.searchParams.has(key)
		) || page > 1;
	setHeaders({ 'cache-control': PRIVATE_NO_STORE_CACHE_CONTROL });

	let game;
	try {
		game = await getGameById(params.appId);
	} catch {
		logDatabaseFailure('game detail query');
		return {
			available: false,
			appId: params.appId,
			canonical: absoluteUrl(`/games/${params.appId}`),
			filters: { gpuVendors: [], distributions: [], proton: [] },
			reportData: null,
			nativeReportData: null,
			filtered
		};
	}
	if (!game) error(404, 'Game not found');
	if (params.slug !== game.slug) redirect(308, `/games/${game.appId}/${game.slug}${url.search}`);

	let reportData = null;
	let nativeReportData = null;
	let filters = {
		gpuVendors: [] as string[],
		distributions: [] as string[],
		proton: [] as { value: string; label: string }[]
	};
	try {
		[reportData, filters] = await Promise.all([
			getGameReports(params.appId, {
				page,
				gpuVendor,
				distribution,
				proton,
				verdict,
				since: validSince,
				until: validUntil
			}),
			getGameReportFilters(params.appId)
		]);
	} catch {
		logDatabaseFailure('game report queries');
	}
	try {
		nativeReportData = await getPublishedNativeReports(
			params.appId,
			communityPageSchema.parse(url.searchParams.get('communityPage') ?? '1')
		);
	} catch {
		logDatabaseFailure('native community report query');
	}
	const canonical = absoluteUrl(`/games/${game.appId}/${game.slug}`);
	const description = plainDescription(
		`${game.title}: see the TuxGG compatibility tier, Linux and Steam Deck reports, Proton versions, hardware, and workarounds.`
	);
	return {
		available: true,
		appId: params.appId,
		game,
		reportData,
		nativeReportData,
		filters,
		query: {
			page,
			gpuVendor,
			distribution,
			proton,
			verdict,
			since: sinceResult.data,
			until: untilResult.data
		},
		filtered,
		canonical,
		ogImage: absoluteUrl('/og-default.png'),
		description
	};
};
