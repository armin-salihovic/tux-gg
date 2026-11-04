import { and, asc, count, countDistinct, desc, eq, gte, lt, or, sql } from 'drizzle-orm';
import { getDb } from '#lib/server/db/db.js';
import {
	authAccount,
	authUser,
	compatibilitySummaries,
	games,
	nativeReports,
	reports
} from '#lib/server/db/schema.js';
import type { CompatibilityTier } from '#lib/scoring.js';

export type CatalogSort = 'title' | 'reports' | 'recent' | 'tier';

export interface GameQuery {
	q: string;
	tier?: CompatibilityTier;
	sort: CatalogSort;
	page: number;
	pageSize?: number;
}

export interface ReportFilters {
	page: number;
	pageSize?: number;
	gpuVendor?: string;
	distribution?: string;
	proton?: string;
	verdict?: 'yes' | 'no';
	since?: Date;
	until?: Date;
}

const scoreOrder = sql`CASE ${compatibilitySummaries.tier}
	WHEN 'platinum' THEN 1 WHEN 'gold' THEN 2 WHEN 'silver' THEN 3
	WHEN 'bronze' THEN 4 WHEN 'borked' THEN 5 ELSE 6 END`;

export async function getCatalog(query: GameQuery) {
	const db = getDb();
	const pageSize = Math.min(48, Math.max(1, query.pageSize ?? 24));
	const page = Math.max(1, query.page);
	const conditions = [];
	const term = query.q.trim().slice(0, 100);

	if (term) {
		const pattern = `%${term.replace(/[\\%_]/g, '\\$&')}%`;
		conditions.push(
			or(
				eq(games.appId, term),
				sql`${games.searchVector} @@ websearch_to_tsquery('simple', ${term})`,
				sql`lower(${games.title}) LIKE lower(${pattern}) ESCAPE ${'\\'}`,
				sql`lower(${games.title}) % lower(${term})`
			)!
		);
	}
	if (query.tier) conditions.push(eq(compatibilitySummaries.tier, query.tier));
	const where = conditions.length ? and(...conditions) : undefined;

	const totalQuery = db
		.select({ total: count() })
		.from(games)
		.leftJoin(compatibilitySummaries, eq(compatibilitySummaries.appId, games.appId));
	const [{ total }] = where ? await totalQuery.where(where) : await totalQuery;

	const rank = term
		? sql<number>`CASE WHEN ${games.appId} = ${term} THEN 100
			ELSE ts_rank(${games.searchVector}, websearch_to_tsquery('simple', ${term}))
				+ similarity(lower(coalesce(${games.title}, '')), lower(${term})) END`.mapWith(Number)
		: sql<number>`0`.mapWith(Number);

	const order = term
		? [desc(rank), desc(compatibilitySummaries.reportCount), asc(games.title)]
		: query.sort === 'reports'
			? [desc(compatibilitySummaries.reportCount), asc(games.title)]
			: query.sort === 'recent'
				? [desc(compatibilitySummaries.lastReportAt), desc(compatibilitySummaries.reportCount)]
				: query.sort === 'tier'
					? [
							asc(scoreOrder),
							desc(compatibilitySummaries.weightedScore),
							desc(compatibilitySummaries.reportCount)
						]
					: [asc(games.title), asc(games.appId)];

	const rows = await db
		.select({
			appId: games.appId,
			title: games.title,
			slug: games.slug,
			artworkUrl: games.artworkUrl,
			tier: compatibilitySummaries.tier,
			reportCount: compatibilitySummaries.reportCount,
			yesCount: compatibilitySummaries.yesCount,
			noCount: compatibilitySummaries.noCount,
			weightedScore: compatibilitySummaries.weightedScore,
			lastReportAt: compatibilitySummaries.lastReportAt,
			rank
		})
		.from(games)
		.leftJoin(compatibilitySummaries, eq(compatibilitySummaries.appId, games.appId))
		.where(where)
		.orderBy(...order)
		.limit(pageSize)
		.offset((page - 1) * pageSize);

	return {
		games: rows.map((row) => ({
			...row,
			tier: row.tier ?? 'unknown',
			reportCount: row.reportCount ?? 0
		})),
		total,
		page,
		pageSize,
		pageCount: Math.max(1, Math.ceil(total / pageSize))
	};
}

export async function getHomeData() {
	const db = getDb();
	const [popular, recent, tierRows, stats] = await Promise.all([
		db
			.select({
				appId: games.appId,
				title: games.title,
				slug: games.slug,
				tier: compatibilitySummaries.tier,
				reportCount: compatibilitySummaries.reportCount,
				weightedScore: compatibilitySummaries.weightedScore
			})
			.from(games)
			.innerJoin(compatibilitySummaries, eq(compatibilitySummaries.appId, games.appId))
			.orderBy(desc(compatibilitySummaries.reportCount), desc(compatibilitySummaries.lastReportAt))
			.limit(8),
		db
			.select({
				appId: games.appId,
				title: games.title,
				slug: games.slug,
				tier: compatibilitySummaries.tier,
				reportCount: compatibilitySummaries.reportCount,
				lastReportAt: compatibilitySummaries.lastReportAt
			})
			.from(games)
			.innerJoin(compatibilitySummaries, eq(compatibilitySummaries.appId, games.appId))
			.orderBy(desc(compatibilitySummaries.lastReportAt))
			.limit(6),
		db
			.select({ tier: compatibilitySummaries.tier, total: count() })
			.from(compatibilitySummaries)
			.groupBy(compatibilitySummaries.tier),
		db
			.select({ games: countDistinct(games.appId), reports: count(reports.id) })
			.from(games)
			.leftJoin(reports, eq(reports.appId, games.appId))
	]);
	return {
		popular,
		recent,
		tiers: Object.fromEntries(tierRows.map((row) => [row.tier, row.total])),
		totalGames: stats[0]?.games ?? 0,
		totalReports: stats[0]?.reports ?? 0
	};
}

export async function getGameById(appId: string) {
	const db = getDb();
	const [game] = await db
		.select({
			appId: games.appId,
			title: games.title,
			slug: games.slug,
			artworkUrl: games.artworkUrl,
			headerImageUrl: games.headerImageUrl,
			tier: compatibilitySummaries.tier,
			reportCount: compatibilitySummaries.reportCount,
			scoredReportCount: compatibilitySummaries.scoredReportCount,
			yesCount: compatibilitySummaries.yesCount,
			noCount: compatibilitySummaries.noCount,
			weightedScore: compatibilitySummaries.weightedScore,
			effectiveSampleSize: compatibilitySummaries.effectiveSampleSize,
			verdictDistribution: compatibilitySummaries.verdictDistribution,
			lastReportAt: compatibilitySummaries.lastReportAt,
			calculatedAt: compatibilitySummaries.calculatedAt
		})
		.from(games)
		.leftJoin(compatibilitySummaries, eq(compatibilitySummaries.appId, games.appId))
		.where(eq(games.appId, appId))
		.limit(1);
	return game
		? {
				...game,
				title: game.title ?? `Steam app ${appId}`,
				tier: game.tier ?? 'unknown',
				reportCount: game.reportCount ?? 0
			}
		: null;
}

function reportConditions(appId: string, filters: ReportFilters) {
	const conditions = [eq(reports.appId, appId)];
	if (filters.gpuVendor) conditions.push(eq(reports.gpuVendor, filters.gpuVendor));
	if (filters.distribution) conditions.push(eq(reports.distribution, filters.distribution));
	if (filters.verdict) conditions.push(eq(reports.sourceVerdict, filters.verdict));
	if (filters.proton) {
		const separator = filters.proton.indexOf(':');
		const field = filters.proton.slice(0, separator);
		const value = filters.proton.slice(separator + 1);
		if (value && field === 'variant') conditions.push(eq(reports.protonVariant, value));
		if (value && field === 'version') conditions.push(eq(reports.protonVersion, value));
	}
	if (filters.since) conditions.push(gte(reports.submittedAt, filters.since));
	if (filters.until) conditions.push(lt(reports.submittedAt, filters.until));
	return and(...conditions);
}

export async function getGameReportFilters(appId: string) {
	const db = getDb();
	const [gpuRows, distributionRows, protonRows] = await Promise.all([
		db
			.select({ value: reports.gpuVendor, total: count() })
			.from(reports)
			.where(eq(reports.appId, appId))
			.groupBy(reports.gpuVendor)
			.orderBy(desc(count()))
			.limit(10),
		db
			.select({ value: reports.distribution, total: count() })
			.from(reports)
			.where(and(eq(reports.appId, appId), sql`${reports.distribution} is not null`))
			.groupBy(reports.distribution)
			.orderBy(desc(count()))
			.limit(20),
		db
			.select({ variant: reports.protonVariant, version: reports.protonVersion, total: count() })
			.from(reports)
			.where(eq(reports.appId, appId))
			.groupBy(reports.protonVariant, reports.protonVersion)
			.orderBy(desc(count()))
			.limit(40)
	]);
	return {
		gpuVendors: gpuRows
			.filter((row) => row.value && row.value !== 'Unknown')
			.map((row) => row.value!),
		distributions: distributionRows.map((row) => row.value!).filter(Boolean),
		proton: [
			...new Map(
				protonRows
					.flatMap((row) => [
						...(row.variant ? [{ value: `variant:${row.variant}`, label: row.variant }] : []),
						...(row.version ? [{ value: `version:${row.version}`, label: row.version }] : [])
					])
					.map((option) => [option.value, option])
			).values()
		]
	};
}

export async function getGameReports(appId: string, filters: ReportFilters) {
	const db = getDb();
	const pageSize = Math.min(40, Math.max(1, filters.pageSize ?? 20));
	const page = Math.max(1, filters.page);
	const where = reportConditions(appId, filters);
	const [{ total }] = await db.select({ total: count() }).from(reports).where(where);
	const rows = await db
		.select({
			id: reports.id,
			source: reports.source,
			submittedAt: reports.submittedAt,
			sourceVerdict: reports.sourceVerdict,
			sourceRating: reports.sourceRating,
			protonVersion: reports.protonVersion,
			protonVariant: reports.protonVariant,
			customProtonVersion: reports.customProtonVersion,
			distribution: reports.distribution,
			kernel: reports.kernel,
			cpu: reports.cpu,
			gpu: reports.gpu,
			gpuVendor: reports.gpuVendor,
			graphicsDriver: reports.graphicsDriver,
			ram: reports.ram,
			steamRuntimeVersion: reports.steamRuntimeVersion,
			xWindowManager: reports.xWindowManager,
			launchOptions: reports.launchOptions,
			comments: reports.comments
		})
		.from(reports)
		.where(where)
		.orderBy(desc(reports.submittedAt), desc(reports.id))
		.limit(pageSize)
		.offset((page - 1) * pageSize);

	const [launchOptions, hardware, nativeCount] = await Promise.all([
		db
			.select({ value: reports.launchOptions, total: count() })
			.from(reports)
			.where(and(eq(reports.appId, appId), sql`${reports.launchOptions} is not null`))
			.groupBy(reports.launchOptions)
			.orderBy(desc(count()))
			.limit(5),
		db
			.select({
				gpu: reports.gpu,
				cpu: reports.cpu,
				distribution: reports.distribution,
				total: count()
			})
			.from(reports)
			.where(eq(reports.appId, appId))
			.groupBy(reports.gpu, reports.cpu, reports.distribution)
			.orderBy(desc(count()))
			.limit(6),
		db
			.select({ total: count() })
			.from(nativeReports)
			.where(and(eq(nativeReports.appId, appId), eq(nativeReports.moderationState, 'published')))
	]);
	return {
		reports: rows,
		total,
		page,
		pageSize,
		pageCount: Math.max(1, Math.ceil(total / pageSize)),
		launchOptions: launchOptions
			.filter((row) => row.value)
			.map((row) => ({ value: row.value!, count: row.total })),
		hardware,
		nativeReportCount: nativeCount[0]?.total ?? 0
	};
}

export async function getProfile(username: string) {
	const db = getDb();
	const [profile] = await db
		.select({
			id: authUser.id,
			name: authUser.name,
			username: authUser.username,
			image: authUser.image,
			createdAt: authUser.createdAt,
			contributionCount: count(nativeReports.id)
		})
		.from(authUser)
		.leftJoin(
			nativeReports,
			and(eq(nativeReports.authorId, authUser.id), eq(nativeReports.moderationState, 'published'))
		)
		.where(eq(authUser.username, username))
		.groupBy(authUser.id)
		.limit(1);
	return profile ?? null;
}

export async function getSettingsProfile(userId: string) {
	const db = getDb();
	const [user] = await db
		.select({
			id: authUser.id,
			name: authUser.name,
			username: authUser.username,
			image: authUser.image
		})
		.from(authUser)
		.where(eq(authUser.id, userId))
		.limit(1);
	if (!user) return null;
	const linked = await db
		.select({ providerId: authAccount.providerId })
		.from(authAccount)
		.where(eq(authAccount.userId, userId));
	return { ...user, discordConnected: linked.some((account) => account.providerId === 'discord') };
}

export async function getSitemapGames(offset: number, limit: number) {
	const db = getDb();
	const [countRow] = await db.select({ total: count() }).from(games);
	const rows = await db
		.select({ appId: games.appId, slug: games.slug, updatedAt: games.updatedAt })
		.from(games)
		.orderBy(asc(games.appId))
		.limit(limit)
		.offset(offset);
	return { total: countRow?.total ?? 0, games: rows };
}
