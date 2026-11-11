import { and, asc, count, desc, eq, or, sql } from 'drizzle-orm';
import { getDb, getPool } from '#lib/server/db/db.js';
import { authAccount, authUser, games, nativeReports } from '#lib/server/db/schema.js';
import { MIN_EFFECTIVE_SAMPLE_SIZE, MIN_TOTAL_WEIGHT, tierForEvidence } from '#lib/scoring.js';

export type CatalogSort = 'title' | 'reports' | 'recent' | 'tier';

export interface GameQuery {
	q: string;
	sort: CatalogSort;
	page: number;
	pageSize?: number;
}

export interface NativeReportFilters {
	page: number;
	pageSize?: number;
	gpuVendor?: string;
	distribution?: string;
	proton?: string;
	verdict?: 'yes' | 'no';
	since?: Date;
	until?: Date;
}

const PUBLIC_REPORTS = `
	SELECT app_id,
	       count(*)::int AS report_count,
	       count(*) FILTER (WHERE verdict = 'yes')::int AS yes_count,
	       count(*) FILTER (WHERE verdict = 'no')::int AS no_count,
	       sum(weight) AS total_weight,
	       sum(weight * weight) AS squared_weight,
	       sum(weight) FILTER (WHERE verdict = 'yes') / nullif(sum(weight), 0) AS weighted_score,
	       max(report_at) AS last_report_at
	FROM (
		SELECT app_id, verdict, created_at AS report_at,
		       power(0.5::float8,
		         greatest(0::float8, extract(epoch FROM (now() - created_at)) / 86400.0)
		         / 365.0) AS weight
		FROM public.native_reports
		WHERE moderation_state IN ('pending', 'published')
	) AS public_reports
	GROUP BY app_id`;

function withCompatibility<
	T extends {
		weighted_score?: number | string | null;
		total_weight?: number | string | null;
		squared_weight?: number | string | null;
	}
>(row: T) {
	const weightedScore = row.weighted_score == null ? null : Number(row.weighted_score);
	const totalWeight = Number(row.total_weight ?? 0);
	const squaredWeight = Number(row.squared_weight ?? 0);
	const effectiveSampleSize = squaredWeight > 0 ? (totalWeight * totalWeight) / squaredWeight : 0;
	return {
		...row,
		weightedScore,
		effectiveSampleSize,
		tier: tierForEvidence(weightedScore, totalWeight, effectiveSampleSize)
	};
}

function catalogConditions(term: string) {
	if (!term) return '';
	return `AND (
		g.app_id = $1
		OR g.search_vector @@ websearch_to_tsquery('simple', $1)
		OR position(lower($1) in lower(coalesce(g.title, ''))) > 0
		OR lower(coalesce(g.title, '')) % lower($1)
	)`;
}

export async function getCatalog(query: GameQuery) {
	const pageSize = Math.min(48, Math.max(1, query.pageSize ?? 24));
	const page = Math.max(1, query.page);
	const term = query.q.trim().slice(0, 100);
	const where = catalogConditions(term);
	const values = term ? [term] : [];
	const totalResult = await getPool().query<{ total: number }>(
		`WITH report_stats AS (${PUBLIC_REPORTS})
		 SELECT count(*)::int AS total
		 FROM public.games AS g
		 LEFT JOIN report_stats AS r ON r.app_id = g.app_id
		 WHERE true ${where}`,
		values
	);
	const total = totalResult.rows[0]?.total ?? 0;
	const rank = term
		? `CASE WHEN g.app_id = $1 THEN 100::real
			ELSE ts_rank(g.search_vector, websearch_to_tsquery('simple', $1))
				+ similarity(lower(coalesce(g.title, '')), lower($1)) END`
		: '0::real';
	const order =
		query.sort === 'reports'
			? 'report_count DESC, last_report_at DESC NULLS LAST, g.title ASC NULLS LAST, g.app_id ASC'
			: query.sort === 'recent'
				? 'last_report_at DESC NULLS LAST, g.updated_at DESC, g.title ASC NULLS LAST, g.app_id ASC'
				: query.sort === 'tier'
					? `CASE WHEN r.weighted_score IS NULL OR r.total_weight < ${MIN_TOTAL_WEIGHT} OR
							(r.total_weight * r.total_weight / nullif(r.squared_weight, 0)) < ${MIN_EFFECTIVE_SAMPLE_SIZE} THEN 6
							WHEN r.weighted_score >= 0.95 THEN 1 WHEN r.weighted_score >= 0.8 THEN 2
							WHEN r.weighted_score >= 0.6 THEN 3 WHEN r.weighted_score >= 0.3 THEN 4 ELSE 5 END,
							r.weighted_score DESC NULLS LAST, report_count DESC, g.title ASC NULLS LAST`
					: term
						? 'rank DESC, report_count DESC, g.title ASC NULLS LAST, g.app_id ASC'
						: 'g.title ASC NULLS LAST, g.app_id ASC';
	const pagination = term ? 'LIMIT $2 OFFSET $3' : 'LIMIT $1 OFFSET $2';
	const rows = await getPool().query(
		`WITH report_stats AS (${PUBLIC_REPORTS})
		 SELECT g.app_id AS "appId", g.title, g.slug, g.artwork_url AS "artworkUrl",
		        coalesce(r.report_count, 0)::int AS "reportCount",
		        coalesce(r.yes_count, 0)::int AS "yesCount",
		        coalesce(r.no_count, 0)::int AS "noCount",
		        r.total_weight, r.squared_weight, r.weighted_score,
		        r.last_report_at AS "lastReportAt", ${rank} AS rank
		 FROM public.games AS g
		 LEFT JOIN report_stats AS r ON r.app_id = g.app_id
		 WHERE true ${where}
		 ORDER BY ${order}
		 ${pagination}`,
		term ? [term, pageSize, (page - 1) * pageSize] : [pageSize, (page - 1) * pageSize]
	);
	return {
		games: rows.rows.map((row) => ({ ...withCompatibility(row), rank: Number(row.rank) })),
		total,
		page,
		pageSize,
		pageCount: Math.max(1, Math.ceil(total / pageSize))
	};
}

export async function getHomeData() {
	const pool = getPool();
	const [totals, popular, recent] = await Promise.all([
		pool.query<{ totalGames: number; totalReports: number }>(
			`SELECT (SELECT count(*)::int FROM public.games) AS "totalGames",
			        (SELECT count(*)::int FROM public.native_reports WHERE moderation_state IN ('pending', 'published')) AS "totalReports"`
		),
		pool.query(
			`WITH report_stats AS (${PUBLIC_REPORTS})
			 SELECT g.app_id AS "appId", g.title, g.slug, g.artwork_url AS "artworkUrl",
			        coalesce(r.report_count, 0)::int AS "reportCount",
			        coalesce(r.yes_count, 0)::int AS "yesCount",
			        coalesce(r.no_count, 0)::int AS "noCount",
			        r.total_weight, r.squared_weight, r.weighted_score,
			        r.last_report_at AS "lastReportAt"
			 FROM public.games AS g LEFT JOIN report_stats AS r ON r.app_id = g.app_id
			 ORDER BY coalesce(r.report_count, 0) DESC, r.last_report_at DESC NULLS LAST,
			          g.title ASC NULLS LAST, g.app_id ASC LIMIT 8`
		),
		pool.query(
			`WITH report_stats AS (${PUBLIC_REPORTS})
			 SELECT g.app_id AS "appId", g.title, g.slug, g.artwork_url AS "artworkUrl",
			        coalesce(r.report_count, 0)::int AS "reportCount",
			        coalesce(r.yes_count, 0)::int AS "yesCount",
			        coalesce(r.no_count, 0)::int AS "noCount",
			        r.total_weight, r.squared_weight, r.weighted_score,
			        r.last_report_at AS "lastReportAt"
			 FROM public.games AS g LEFT JOIN report_stats AS r ON r.app_id = g.app_id
			 ORDER BY coalesce(r.last_report_at, g.updated_at) DESC, g.app_id ASC LIMIT 6`
		)
	]);
	return {
		popular: popular.rows.map(withCompatibility),
		recent: recent.rows.map(withCompatibility),
		totalGames: totals.rows[0]?.totalGames ?? 0,
		totalReports: totals.rows[0]?.totalReports ?? 0
	};
}

export async function getGameById(appId: string) {
	const result = await getPool().query(
		`SELECT g.app_id AS "appId", g.title, g.slug, g.artwork_url AS "artworkUrl",
		        g.header_image_url AS "headerImageUrl", g.metadata,
		        coalesce(r.report_count, 0)::int AS "reportCount",
		        coalesce(r.yes_count, 0)::int AS "yesCount",
		        coalesce(r.no_count, 0)::int AS "noCount",
		        r.total_weight, r.squared_weight, r.weighted_score,
		        r.last_report_at AS "lastReportAt"
		 FROM public.games AS g
		 LEFT JOIN (${PUBLIC_REPORTS}) AS r ON r.app_id = g.app_id
		 WHERE g.app_id = $1
		 LIMIT 1`,
		[appId]
	);
	const game = result.rows[0];
	return game
		? {
				...withCompatibility(game),
				title: game.title ?? `Steam app ${appId}`,
				titleAvailable: Boolean(game.title?.trim()),
				metadata: game.metadata ?? {}
			}
		: null;
}

function nativeReportWhere(appId: string, filters: NativeReportFilters) {
	const values: Array<string | Date> = [appId];
	const conditions = ['report.app_id = $1', "report.moderation_state IN ('pending', 'published')"];
	const add = (column: string, value: string | Date | undefined) => {
		if (value === undefined) return;
		values.push(value);
		conditions.push(`${column} = $${values.length}`);
	};
	add('report.gpu_vendor', filters.gpuVendor);
	add('report.distribution', filters.distribution);
	add('report.verdict', filters.verdict);
	if (filters.proton) {
		const separator = filters.proton.indexOf(':');
		const field = filters.proton.slice(0, separator);
		const value = filters.proton.slice(separator + 1);
		if (value && field === 'variant') add('report.proton_variant', value);
		if (value && field === 'version') add('report.proton_version', value);
	}
	if (filters.since) {
		values.push(filters.since);
		conditions.push(`report.created_at >= $${values.length}`);
	}
	if (filters.until) {
		values.push(filters.until);
		conditions.push(`report.created_at < $${values.length}`);
	}
	return { values, where: conditions.join(' AND ') };
}

export async function getNativeReportFilters(appId: string) {
	const pool = getPool();
	const [gpuRows, distributionRows, protonRows] = await Promise.all([
		pool.query<{ value: string; total: number }>(
			`SELECT gpu_vendor AS value, count(*)::int AS total FROM public.native_reports
			 WHERE app_id = $1 AND moderation_state IN ('pending', 'published') AND gpu_vendor IS NOT NULL
			 GROUP BY gpu_vendor ORDER BY count(*) DESC LIMIT 10`,
			[appId]
		),
		pool.query<{ value: string; total: number }>(
			`SELECT distribution AS value, count(*)::int AS total FROM public.native_reports
			 WHERE app_id = $1 AND moderation_state IN ('pending', 'published') AND distribution IS NOT NULL
			 GROUP BY distribution ORDER BY count(*) DESC LIMIT 20`,
			[appId]
		),
		pool.query<{ variant: string | null; version: string | null; total: number }>(
			`SELECT proton_variant AS variant, proton_version AS version, count(*)::int AS total
			 FROM public.native_reports WHERE app_id = $1 AND moderation_state IN ('pending', 'published')
			 GROUP BY proton_variant, proton_version ORDER BY count(*) DESC LIMIT 40`,
			[appId]
		)
	]);
	return {
		gpuVendors: gpuRows.rows
			.map((row) => row.value)
			.filter((value) => value && value !== 'Unknown'),
		distributions: distributionRows.rows.map((row) => row.value).filter(Boolean),
		proton: [
			...new Map(
				protonRows.rows
					.flatMap((row) => [
						...(row.variant ? [{ value: `variant:${row.variant}`, label: row.variant }] : []),
						...(row.version ? [{ value: `version:${row.version}`, label: row.version }] : [])
					])
					.map((option) => [option.value, option])
			).values()
		]
	};
}

export async function getPublicNativeReports(appId: string, filters: NativeReportFilters) {
	const pool = getPool();
	const pageSize = Math.min(40, Math.max(1, filters.pageSize ?? 20));
	const page = Math.max(1, filters.page);
	const { values, where } = nativeReportWhere(appId, filters);
	const [countResult, rows] = await Promise.all([
		pool.query<{ total: number }>(
			`SELECT count(*)::int AS total FROM public.native_reports AS report WHERE ${where}`,
			values
		),
		pool.query(
			`SELECT report.id, author.username AS "authorUsername", report.verdict, report.platform,
			        report.proton_version AS "protonVersion", report.proton_variant AS "protonVariant",
			        report.custom_proton_version AS "customProtonVersion", report.distribution, report.kernel,
			        report.cpu, report.gpu, report.gpu_vendor AS "gpuVendor",
			        report.graphics_driver AS "graphicsDriver", report.gpu_driver_detail AS "gpuDriverDetail",
			        report.ram, report.device_name_snapshot AS "deviceNameSnapshot",
			        report.launch_options AS "launchOptions", report.performance_notes AS "performanceNotes",
			        report.known_issues AS "knownIssues", report.content, report.created_at AS "createdAt"
			 FROM public.native_reports AS report
			 JOIN public."user" AS author ON author.id = report.author_id
			 WHERE ${where}
			 ORDER BY report.created_at DESC, report.id DESC
			 LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
			[...values, pageSize, (page - 1) * pageSize]
		)
	]);
	const total = countResult.rows[0]?.total ?? 0;
	return {
		reports: rows.rows,
		total,
		page,
		pageSize,
		pageCount: Math.max(1, Math.ceil(total / pageSize))
	};
}

export async function getMyNativeReports(userId: string, requestedPage = 1) {
	const db = getDb();
	const pageSize = 20;
	const page = Math.max(1, Math.min(10_000, requestedPage));
	const [totalRow] = await db
		.select({ total: count() })
		.from(nativeReports)
		.where(eq(nativeReports.authorId, userId));
	const rows = await db
		.select({
			id: nativeReports.id,
			appId: games.appId,
			title: games.title,
			slug: games.slug,
			artworkUrl: games.artworkUrl,
			verdict: nativeReports.verdict,
			platform: nativeReports.platform,
			deviceNameSnapshot: nativeReports.deviceNameSnapshot,
			content: nativeReports.content,
			isPublic: sql<boolean>`${nativeReports.moderationState} in ('pending', 'published')`,
			createdAt: nativeReports.createdAt
		})
		.from(nativeReports)
		.innerJoin(games, eq(games.appId, nativeReports.appId))
		.where(eq(nativeReports.authorId, userId))
		.orderBy(desc(nativeReports.createdAt), desc(nativeReports.id))
		.limit(pageSize)
		.offset((page - 1) * pageSize);
	const total = totalRow?.total ?? 0;
	return {
		reports: rows,
		total,
		page,
		pageSize,
		pageCount: Math.max(1, Math.ceil(total / pageSize))
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
			and(
				eq(nativeReports.authorId, authUser.id),
				or(
					eq(nativeReports.moderationState, 'pending'),
					eq(nativeReports.moderationState, 'published')
				)
			)
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
		.select({ providerId: authAccount.providerId, accountId: authAccount.accountId })
		.from(authAccount)
		.where(eq(authAccount.userId, userId));
	const steamAccount = linked.find((account) => account.providerId === 'steam');
	return {
		...user,
		steamConnected: Boolean(steamAccount),
		steamId: steamAccount?.accountId ?? null,
		steamProfileUrl: steamAccount
			? `https://steamcommunity.com/profiles/${steamAccount.accountId}/`
			: null
	};
}

export async function getSitemapGames(offset: number, limit: number) {
	const db = getDb();
	const indexable = sql`
		length(btrim(coalesce(${games.title}, ''))) > 0
		AND length(btrim(${games.slug})) > 0
		AND ${games.appId} ~ '^[0-9]+$'
		AND length(btrim(coalesce(${games.metadata} #>> '{steam,shortDescription}', ''))) >= 50
	`;
	const [countRow] = await db.select({ total: count() }).from(games).where(indexable);
	const rows = await db
		.select({ appId: games.appId, slug: games.slug, updatedAt: games.updatedAt })
		.from(games)
		.where(indexable)
		.orderBy(asc(games.appId))
		.limit(limit)
		.offset(offset);
	return { total: countRow?.total ?? 0, games: rows };
}
