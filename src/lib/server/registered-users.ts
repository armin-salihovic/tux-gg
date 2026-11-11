import { getPool } from '#lib/server/db/db.js';
import { isValidUsername } from '#lib/usernames.js';

export const REGISTERED_USERS_PAGE_SIZE = 25;
const MAX_PAGE_NUMBER = 2_147_483_647;
const registrationDateFormatter = new Intl.DateTimeFormat('en-GB', {
	year: 'numeric',
	month: 'short',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	timeZone: 'UTC',
	timeZoneName: 'short'
});

export type RegisteredUserSummary = {
	userId: string;
	name: string;
	username: string;
	profilePath: string | null;
	registeredAt: string;
	registeredAtLabel: string;
	reviewsSubmitted: number;
};

export type RegisteredUsersPage = {
	users: RegisteredUserSummary[];
	totalUsers: number;
	page: number;
	pageCount: number;
};

export function parseRegisteredUsersPage(value: string | null): number {
	if (!value || !/^[1-9]\d{0,9}$/.test(value)) return 1;
	const page = Number(value);
	return Number.isSafeInteger(page) && page <= MAX_PAGE_NUMBER ? page : 1;
}

export function getRegisteredUsersPageCount(totalUsers: number): number {
	return Math.max(1, Math.ceil(totalUsers / REGISTERED_USERS_PAGE_SIZE));
}

export function getPublicUsernamePath(username: string): string | null {
	return isValidUsername(username) ? `/users/${username}` : null;
}

export async function listRegisteredUsers(requestedPage: number): Promise<RegisteredUsersPage> {
	const pool = getPool();
	const countResult = await pool.query<{ total: string }>(
		' SELECT COUNT(*)::text AS total FROM public."user"'
	);
	const parsedTotal = Number(countResult.rows[0]?.total ?? '0');
	const totalUsers = Number.isFinite(parsedTotal) ? Math.max(0, parsedTotal) : 0;
	const pageCount = getRegisteredUsersPageCount(totalUsers);
	const page = Math.min(Math.max(1, requestedPage), pageCount);
	const offset = (page - 1) * REGISTERED_USERS_PAGE_SIZE;

	const pageResult = await pool.query<{
		userId: string;
		name: string;
		username: string;
		registeredAt: Date | string;
		reviewsSubmitted: string | number;
	}>(
		`WITH page_users AS (
			SELECT id, name, username, created_at
			FROM public."user"
			ORDER BY created_at DESC, id DESC
			LIMIT $1 OFFSET $2
		), review_counts AS (
			SELECT report.author_id, COUNT(*) AS review_count
			FROM public.native_reports AS report
			INNER JOIN page_users AS page ON page.id = report.author_id
			GROUP BY report.author_id
		)
		SELECT page.id AS "userId",
			page.name,
			page.username,
			page.created_at AS "registeredAt",
			COALESCE(review_counts.review_count, 0)::text AS "reviewsSubmitted"
		FROM page_users AS page
		LEFT JOIN review_counts ON review_counts.author_id = page.id
		ORDER BY page.created_at DESC, page.id DESC`,
		[REGISTERED_USERS_PAGE_SIZE, offset]
	);

	const users = pageResult.rows.map((row) => {
		const date = row.registeredAt instanceof Date ? row.registeredAt : new Date(row.registeredAt);
		if (Number.isNaN(date.getTime())) throw new Error('Invalid user registration timestamp.');
		const parsedReviews = Number(row.reviewsSubmitted);
		return {
			userId: row.userId,
			name: row.name,
			username: row.username,
			profilePath: getPublicUsernamePath(row.username),
			registeredAt: date.toISOString(),
			registeredAtLabel: registrationDateFormatter.format(date),
			reviewsSubmitted: Number.isFinite(parsedReviews) ? Math.max(0, parsedReviews) : 0
		};
	});

	return { users, totalUsers, page, pageCount };
}
