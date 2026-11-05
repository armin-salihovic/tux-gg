import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { canSubmitReports } from '#lib/server/authz.js';
import { getMyNativeReports, getPublishedNativeReports } from '#lib/server/db/queries.js';
import { closeDatabase, getDb, getPool } from '#lib/server/db/db.js';
import { authAccount, authUser, games, nativeReports } from '#lib/server/db/schema.js';
import { insertNativeReport } from './native-reports.js';

const enabled = process.env.NATIVE_REPORT_INTEGRATION_TESTS === '1';
const databaseUrl = process.env.DATABASE_URL;
let reportId = '';
let userId = '';

describe.skipIf(!enabled)('native report PostgreSQL integration', () => {
	it('stores pending reports for the Steam-linked user and keeps moderation private', async () => {
		if (!databaseUrl || new URL(databaseUrl).pathname.replace(/^\//, '') !== 'tuxgg_test') {
			throw new Error('Native report integration tests require DATABASE_URL to target tuxgg_test.');
		}
		const pool = getPool();
		const identity = await pool.query('SELECT current_database(), current_user');
		if (identity.rows[0]?.current_database !== 'tuxgg_test') {
			throw new Error('Native report integration tests refused a database other than tuxgg_test.');
		}
		expect(identity.rows[0]?.current_user).toBe('tuxgg_web');
		const marker = await pool.query(
			'SELECT marker FROM public.tuxgg_test_safety_marker WHERE id = 1'
		);
		expect(marker.rows[0]?.marker).toBe('tuxgg_disposable_test_database_v1');
		const [game] = await getDb()
			.select({ appId: games.appId })
			.from(games)
			.where(eq(games.appId, '440'));
		expect(game).toBeTruthy();

		const suffix = randomUUID();
		userId = `native-report-${suffix}`;
		const username = `report-${suffix.slice(0, 18)}`;
		await getDb()
			.insert(authUser)
			.values({
				id: userId,
				name: 'Native report test user',
				email: `${suffix}@steam.invalid`,
				username
			});
		expect(await canSubmitReports(userId)).toBe(false);
		await getDb()
			.insert(authAccount)
			.values({
				id: `native-report-account-${suffix}`,
				accountId: `7656119${String(Date.now()).slice(-10)}`,
				providerId: 'steam',
				userId
			});
		expect(await canSubmitReports(userId)).toBe(true);

		reportId = randomUUID();
		const submission = {
			id: reportId,
			appId: '440',
			authorId: userId,
			verdict: 'yes' as const,
			platform: 'steam_deck' as const,
			content: 'A pending report from the database integration test.'
		};
		await insertNativeReport(submission);
		const [saved] = await getDb()
			.select({ moderationState: nativeReports.moderationState })
			.from(nativeReports)
			.where(eq(nativeReports.id, reportId));
		expect(saved?.moderationState).toBe('pending');
		expect((await getMyNativeReports(userId)).reports.map((row) => row.id)).toContain(reportId);
		expect((await getMyNativeReports('another-user')).reports.map((row) => row.id)).not.toContain(
			reportId
		);
		expect((await getPublishedNativeReports('440')).reports.map((row) => row.id)).not.toContain(
			reportId
		);
		await expect(
			insertNativeReport({ ...submission, content: 'Duplicate browser request.' })
		).rejects.toMatchObject({ code: '23505' });

		await expect(
			pool.query(
				'INSERT INTO public.native_reports (id, app_id, author_id, verdict, platform, content, moderation_state) ' +
					"VALUES ($1, '440', $2, 'yes', 'linux_desktop', 'Attempt to set moderation.', 'published')",
				[randomUUID(), userId]
			)
		).rejects.toMatchObject({ code: '42501' });
		await expect(
			pool.query(
				'INSERT INTO public.native_reports (id, app_id, author_id, verdict, platform, content, published_at) ' +
					"VALUES ($1, '440', $2, 'yes', 'linux_desktop', 'Attempt to publish.', now())",
				[randomUUID(), userId]
			)
		).rejects.toMatchObject({ code: '42501' });
		await expect(
			pool.query('UPDATE public.native_reports SET moderation_state = $1 WHERE id = $2', [
				'published',
				reportId
			])
		).rejects.toMatchObject({ code: '42501' });
		await expect(
			pool.query('DELETE FROM public.native_reports WHERE id = $1', [reportId])
		).rejects.toMatchObject({ code: '42501' });
	});

	afterAll(async () => {
		// The web role intentionally cannot delete submitted data; randomized fixtures remain isolated in tuxgg_test.
		await closeDatabase();
	});
});
