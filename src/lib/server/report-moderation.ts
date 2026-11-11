import { getPool } from '#lib/server/db/db.js';

export const REPORT_MODERATION_PAGE_SIZE = 25;
export const REPORT_MODERATION_STATES = ['pending', 'published', 'hidden', 'removed'] as const;
export type ReportModerationState = (typeof REPORT_MODERATION_STATES)[number];
export type ReportModerationFilter = 'pending' | 'published' | 'hidden' | 'removed' | 'all';
export type ReportModerationAction = 'review' | 'hide' | 'remove' | 'restore';

const MAX_PAGE = 2_147_483_647;
const stateSet = new Set<string>(REPORT_MODERATION_STATES);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseReportModerationPage(value: string | null): number {
	if (!value || !/^[1-9]\d{0,9}$/.test(value)) return 1;
	const page = Number(value);
	return Number.isSafeInteger(page) && page <= MAX_PAGE ? page : 1;
}

export function parseReportModerationFilter(value: string | null): ReportModerationFilter {
	return value === 'published' || value === 'hidden' || value === 'removed' || value === 'all'
		? value
		: 'pending';
}

export interface ReportModerationQuery {
	filter: ReportModerationFilter;
	search: string;
	userId?: string;
	page: number;
}

export async function listReportsForModeration(query: ReportModerationQuery) {
	const pool = getPool();
	const conditions: string[] = [];
	const values: string[] = [];
	if (query.filter !== 'all') {
		values.push(query.filter);
		conditions.push(`report.moderation_state = $${values.length}`);
	}
	if (query.userId) {
		values.push(query.userId);
		conditions.push(`report.author_id = $${values.length}`);
	}
	const search = query.search.trim().slice(0, 100);
	if (search) {
		values.push(`%${search}%`);
		const searchParam = `$${values.length}`;
		conditions.push(
			`(author.username ILIKE ${searchParam} OR coalesce(game.title, '') ILIKE ${searchParam} OR report.app_id ILIKE ${searchParam})`
		);
	}
	const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
	const countResult = await pool.query<{ total: string | number }>(
		`SELECT count(*)::int AS total
		 FROM public.native_reports AS report
		 JOIN public."user" AS author ON author.id = report.author_id
		 JOIN public.games AS game ON game.app_id = report.app_id ${where}`,
		values
	);
	const total = Number(countResult.rows[0]?.total ?? 0);
	const pageCount = Math.max(1, Math.ceil(total / REPORT_MODERATION_PAGE_SIZE));
	const page = Math.min(Math.max(1, query.page), pageCount);
	const offset = (page - 1) * REPORT_MODERATION_PAGE_SIZE;
	const order =
		query.filter === 'pending'
			? 'report.created_at ASC, report.id ASC'
			: 'report.created_at DESC, report.id DESC';
	const reportsResult = await pool.query(
		`SELECT report.id, report.app_id AS "appId", coalesce(game.title, 'Steam app ' || report.app_id) AS "gameTitle",
		        game.slug AS "gameSlug", game.artwork_url AS "artworkUrl",
		        author.username AS "authorUsername", report.verdict, report.platform,
		        report.moderation_state AS "moderationState", report.created_at AS "createdAt",
		        report.content, report.device_name_snapshot AS "deviceNameSnapshot",
		        report.gpu, report.gpu_vendor AS "gpuVendor", report.cpu, report.ram,
		        report.distribution, report.kernel, report.graphics_driver AS "graphicsDriver",
		        report.gpu_driver_detail AS "gpuDriverDetail", report.proton_version AS "protonVersion",
		        report.proton_variant AS "protonVariant",
		        report.custom_proton_version AS "customProtonVersion",
		        report.performance_notes AS "performanceNotes", report.known_issues AS "knownIssues",
		        report.launch_options AS "launchOptions"
		 FROM public.native_reports AS report
		 JOIN public."user" AS author ON author.id = report.author_id
		 JOIN public.games AS game ON game.app_id = report.app_id
		 ${where}
		 ORDER BY ${order}
		 LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
		[...values, REPORT_MODERATION_PAGE_SIZE, offset]
	);
	const countsResult = await pool.query<{ moderationState: string; total: string | number }>(
		`SELECT moderation_state AS "moderationState", count(*)::int AS total
		 FROM public.native_reports GROUP BY moderation_state`
	);
	const counts = { pending: 0, published: 0, hidden: 0, removed: 0 };
	for (const row of countsResult.rows) {
		if (stateSet.has(row.moderationState)) {
			counts[row.moderationState as ReportModerationState] = Number(row.total);
		}
	}
	return {
		reports: reportsResult.rows,
		counts,
		total,
		page,
		pageSize: REPORT_MODERATION_PAGE_SIZE,
		pageCount
	};
}

const transitionTargets: Record<
	ReportModerationAction,
	Partial<Record<ReportModerationState, 'published' | 'hidden' | 'removed'>>
> = {
	review: { pending: 'published' },
	hide: { pending: 'hidden', published: 'hidden' },
	remove: { pending: 'removed', published: 'removed', hidden: 'removed' },
	restore: { hidden: 'published', removed: 'published' }
};

export type ModerationTransitionResult = 'updated' | 'missing' | 'stale' | 'invalid';

export async function moderateNativeReport(
	id: string,
	fromState: ReportModerationState,
	action: ReportModerationAction
): Promise<ModerationTransitionResult> {
	if (!UUID_PATTERN.test(id)) return 'invalid';
	const targetState = transitionTargets[action]?.[fromState];
	if (!targetState) return 'invalid';
	const pool = getPool();
	const updated = await pool.query(
		`UPDATE public.native_reports
		 SET moderation_state = $3,
		     published_at = CASE WHEN $3 = 'published' THEN COALESCE(published_at, now()) ELSE NULL END,
		     updated_at = now()
		 WHERE id = $1::uuid AND moderation_state = $2
		 RETURNING id`,
		[id, fromState, targetState]
	);
	if (updated.rowCount === 1) return 'updated';
	const current = await pool.query<{ moderationState: string }>(
		'SELECT moderation_state AS "moderationState" FROM public.native_reports WHERE id = $1::uuid',
		[id]
	);
	return current.rows.length ? 'stale' : 'missing';
}
