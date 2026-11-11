import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getGameById, getProfile, getPublicUserReports } from './db/queries.js';
import { closeDatabase, getPool } from './db/db.js';
import { listReportsForModeration, moderateNativeReport } from './report-moderation.js';

const enabled = process.env.AUTH_INTEGRATION_TESTS === '1';

describe.skipIf(!enabled)('report moderation against the marked disposable database', () => {
	it('keeps pending reports public, transitions states safely, and preserves public report ordering', async () => {
		const pool = getPool();
		const identity = await pool.query('SELECT current_database() AS database');
		if (
			identity.rows[0]?.database !== 'vapourdb_test' ||
			process.env.VAPOURDB_TEST_DATABASE !== '1'
		) {
			throw new Error(
				'Report moderation integration tests require the explicitly marked vapourdb_test database.'
			);
		}
		const marker = await pool.query(
			'SELECT marker FROM public.vapourdb_test_safety_marker WHERE id = 1'
		);
		if (marker.rows[0]?.marker !== 'vapourdb_disposable_test_database_v1') {
			throw new Error(
				'Report moderation integration tests require the disposable database marker.'
			);
		}
		const baselineCounts = await pool.query<{ moderation_state: string; total: number }>(
			'SELECT moderation_state, count(*)::int AS total FROM public.native_reports GROUP BY moderation_state'
		);
		const baselineByState = new Map(
			baselineCounts.rows.map((row) => [row.moderation_state, row.total])
		);
		const suffix = randomUUID();
		const userId = `moderation-${suffix}`;
		const username = `moderation-${suffix.slice(0, 18)}`;
		const appId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
		const reportIds = Array.from({ length: 18 }, () => randomUUID());
		const states = [
			'pending',
			'published',
			'pending',
			'published',
			'removed',
			'hidden',
			...Array(12).fill('pending')
		];
		const verdicts = ['yes', 'no', 'yes', 'no', 'no', 'yes', ...Array(12).fill('yes')];
		const originalCreatedAt = new Date(Date.now() - 10_000);
		let fixtureCreated = false;
		try {
			await pool.query('INSERT INTO public.games (app_id, title, slug) VALUES ($1, $2, $3)', [
				appId,
				`Moderation fixture ${suffix}`,
				`moderation-fixture-${suffix.slice(0, 12)}`
			]);
			fixtureCreated = true;
			await pool.query(
				'INSERT INTO public."user" (id, name, email, username) VALUES ($1, $2, $3, $4)',
				[userId, 'Moderation fixture user', `${userId}@moderation.invalid`, username]
			);
			for (let index = 0; index < reportIds.length; index += 1) {
				const reportId = reportIds[index]!;
				await pool.query(
					`INSERT INTO public.native_reports
					 (id, app_id, author_id, verdict, platform, content, moderation_state, created_at, published_at,
					  device_name_snapshot, gpu, gpu_vendor, distribution, proton_version, performance_notes, known_issues, launch_options)
					 VALUES ($1, $2, $3, $4, 'linux_desktop', $5, $6, $7,
					         CASE WHEN $6 = 'published' THEN now() ELSE NULL END,
					         $8, 'Fixture GPU', 'AMD', 'Fixture Linux', 'GE-Proton 9-20', 'Smooth at 60 FPS',
					         'No known issues', 'gamemoderun %command%')`,
					[
						reportId,
						appId,
						userId,
						verdicts[index],
						`Report fixture ${index}`,
						states[index],
						new Date(originalCreatedAt.valueOf() - index * 1000),
						`Fixture device ${index}`
					]
				);
			}

			const profile = await getProfile(username);
			expect(profile).toMatchObject({ contributionCount: 16, worksCount: 14, doesNotWorkCount: 2 });
			const pageOne = await getPublicUserReports(username, 1);
			const pageTwo = await getPublicUserReports(username, 2);
			expect(pageOne).toMatchObject({ total: 16, page: 1, pageSize: 10, pageCount: 2 });
			expect(pageTwo).toMatchObject({ total: 16, page: 2, pageSize: 10, pageCount: 2 });
			expect(pageOne.reports).toHaveLength(10);
			expect(pageTwo.reports).toHaveLength(6);
			const publicIds = [...pageOne.reports, ...pageTwo.reports].map(
				(report) => report.id as string
			);
			expect(publicIds).toHaveLength(16);
			expect(publicIds).not.toContain(reportIds[4]);
			expect(publicIds).not.toContain(reportIds[5]);
			expect(pageOne.reports[0]).toMatchObject({
				appId,
				gameTitle: `Moderation fixture ${suffix}`,
				gameSlug: `moderation-fixture-${suffix.slice(0, 12)}`,
				gpu: 'Fixture GPU',
				distribution: 'Fixture Linux',
				deviceNameSnapshot: 'Fixture device 0',
				protonVersion: 'GE-Proton 9-20',
				performanceNotes: 'Smooth at 60 FPS',
				knownIssues: 'No known issues',
				launchOptions: 'gamemoderun %command%'
			});
			expect(JSON.stringify(profile)).not.toMatch(/email|token|session|ipAddress|steam/i);
			expect(JSON.stringify(pageOne)).not.toMatch(
				/email|token|session|ipAddress|moderationState|hidden|removed/i
			);
			const allStates = await listReportsForModeration({
				filter: 'all',
				search: username,
				userId,
				page: 1
			});
			expect(allStates.reports).toHaveLength(18);
			expect(allStates.counts).toEqual({
				pending: (baselineByState.get('pending') ?? 0) + 14,
				published: (baselineByState.get('published') ?? 0) + 2,
				hidden: (baselineByState.get('hidden') ?? 0) + 1,
				removed: (baselineByState.get('removed') ?? 0) + 1
			});
			expect(allStates.reports[0]).toMatchObject({
				moderationState: 'pending',
				authorUsername: username
			});

			const scoreBeforeReview = await getGameById(appId);
			const publicOrderBeforeReview = publicIds;
			const createdBeforeReview = await pool.query(
				' SELECT created_at FROM public.native_reports WHERE id = $1',
				[reportIds[0]]
			);
			expect(await moderateNativeReport(reportIds[0]!, 'pending', 'review')).toBe('updated');
			expect(await moderateNativeReport(reportIds[0]!, 'pending', 'review')).toBe('stale');
			expect(await moderateNativeReport(randomUUID(), 'pending', 'review')).toBe('missing');
			expect(await moderateNativeReport(reportIds[4]!, 'removed', 'hide')).toBe('invalid');
			const createdAfterReview = await pool.query(
				' SELECT created_at FROM public.native_reports WHERE id = $1',
				[reportIds[0]]
			);
			expect(createdAfterReview.rows[0]?.created_at).toEqual(
				createdBeforeReview.rows[0]?.created_at
			);
			const pageAfterReview = await getPublicUserReports(username, 1);
			const publicOrderAfterReview = [
				...pageAfterReview.reports,
				...(await getPublicUserReports(username, 2)).reports
			].map((report) => report.id as string);
			expect(publicOrderAfterReview).toEqual(publicOrderBeforeReview);
			expect(await getGameById(appId)).toMatchObject({
				reportCount: scoreBeforeReview?.reportCount,
				yesCount: scoreBeforeReview?.yesCount,
				noCount: scoreBeforeReview?.noCount,
				weightedScore: scoreBeforeReview?.weightedScore,
				effectiveSampleSize: scoreBeforeReview?.effectiveSampleSize
			});

			for (const { index, from, action, reportCount, yesCount, noCount } of [
				{ index: 1, from: 'published', action: 'hide', reportCount: 15, yesCount: 14, noCount: 1 },
				{ index: 1, from: 'hidden', action: 'restore', reportCount: 16, yesCount: 14, noCount: 2 },
				{ index: 2, from: 'pending', action: 'hide', reportCount: 15, yesCount: 13, noCount: 2 },
				{ index: 2, from: 'hidden', action: 'restore', reportCount: 16, yesCount: 14, noCount: 2 },
				{
					index: 3,
					from: 'published',
					action: 'remove',
					reportCount: 15,
					yesCount: 14,
					noCount: 1
				},
				{ index: 3, from: 'removed', action: 'restore', reportCount: 16, yesCount: 14, noCount: 2 },
				{ index: 5, from: 'hidden', action: 'remove', reportCount: 16, yesCount: 14, noCount: 2 },
				{ index: 5, from: 'removed', action: 'restore', reportCount: 17, yesCount: 15, noCount: 2 }
			] as const) {
				expect(await moderateNativeReport(reportIds[index]!, from, action)).toBe('updated');
				expect(await getProfile(username)).toMatchObject({
					contributionCount: reportCount,
					worksCount: yesCount,
					doesNotWorkCount: noCount
				});
				expect(await getGameById(appId)).toMatchObject({
					reportCount,
					yesCount,
					noCount
				});
			}
		} finally {
			if (fixtureCreated) {
				await pool.query('DELETE FROM public.games WHERE app_id = $1', [appId]);
				await pool.query('DELETE FROM public."user" WHERE id = $1', [userId]);
			}
		}
	});

	afterAll(async () => {
		if (enabled) await closeDatabase();
	});
});
