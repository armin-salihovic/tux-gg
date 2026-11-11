import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect, test } from '@playwright/test';
import { resolveDatabaseUrl } from '../scripts/database-connection.mjs';

const databaseConnection =
	process.env.DB_CONNECTION === 'pgsql' ? resolveDatabaseUrl('steamRead') : undefined;
const webDatabaseName = databaseConnection?.summary.database ?? '';
const allowlistedSteamId = '76561198129252229';

test.skip(
	webDatabaseName !== 'vapourdb_test' || process.env.VAPOURDB_TEST_DATABASE !== '1',
	'Report profile and moderation browser journeys require the disposable vapourdb_test database.'
);

test('public profile feeds paginate safely and admins moderate reports in the browser', async ({
	page,
	browser,
	baseURL
}) => {
	if (!databaseConnection) throw new Error('The marked test database configuration is missing.');
	const secret = process.env.BETTER_AUTH_SECRET;
	if (!secret) throw new Error('A test Better Auth secret is required for the simulated sessions.');
	const database = new Pool(databaseConnection.options);
	const suffix = randomUUID();
	const authorId = `profile-e2e-${suffix}`;
	const authorUsername = `feed-${suffix.slice(0, 18)}`;
	const emptyUserId = `empty-e2e-${suffix}`;
	const emptyUsername = `empty-${suffix.slice(0, 18)}`;
	const nonAdminId = `nonadmin-e2e-${suffix}`;
	const appId = `9${randomBytes(10).toString('hex').replace(/[a-f]/g, '1').slice(0, 12)}`;
	const slug = `profile-moderation-${suffix.slice(0, 12)}`;
	const reportIds = Array.from({ length: 15 }, () => randomUUID());
	const adminSessionToken = randomBytes(32).toString('base64url');
	const nonAdminSessionToken = randomBytes(32).toString('base64url');
	const createdAdminId = `admin-e2e-${suffix}`;
	let adminUserId: string | undefined;
	let createdAdmin = false;
	let fixturesCreated = false;
	let gameCreated = false;
	try {
		const identity = await database.query('SELECT current_database() AS database');
		expect(identity.rows[0]?.database).toBe('vapourdb_test');
		const marker = await database.query(
			'SELECT marker FROM public.vapourdb_test_safety_marker WHERE id = 1'
		);
		expect(marker.rows[0]?.marker).toBe('vapourdb_disposable_test_database_v1');

		const existingAdmin = await database.query(
			"SELECT user_id FROM public.account WHERE provider_id = 'steam' AND account_id = $1 LIMIT 1",
			[allowlistedSteamId]
		);
		adminUserId = existingAdmin.rows[0]?.user_id;
		if (!adminUserId) {
			adminUserId = createdAdminId;
			createdAdmin = true;
			await database.query(
				'INSERT INTO public."user" (id, name, email, username) VALUES ($1, $2, $3, $4)',
				[
					adminUserId,
					'E2E report admin',
					`${suffix}-admin@steam.invalid`,
					`admin-${suffix.slice(0, 18)}`
				]
			);
			await database.query(
				'INSERT INTO public.account (id, account_id, provider_id, user_id) VALUES ($1, $2, $3, $4)',
				[`${adminUserId}-steam`, allowlistedSteamId, 'steam', adminUserId]
			);
		}
		await database.query(
			'INSERT INTO public."user" (id, name, email, username) VALUES ($1, $2, $3, $4), ($5, $6, $7, $8), ($9, $10, $11, $12)',
			[
				authorId,
				'E2E public profile author',
				`${suffix}-author@steam.invalid`,
				authorUsername,
				emptyUserId,
				'E2E empty profile',
				`${suffix}-empty@steam.invalid`,
				emptyUsername,
				nonAdminId,
				'E2E non-admin',
				`${suffix}-nonadmin@steam.invalid`,
				`nonadmin-${suffix.slice(0, 18)}`
			]
		);
		fixturesCreated = true;
		const adminSignature = createHmac('sha256', secret).update(adminSessionToken).digest('base64');
		const nonAdminSignature = createHmac('sha256', secret)
			.update(nonAdminSessionToken)
			.digest('base64');
		await database.query(
			"INSERT INTO public.session (id, token, user_id, expires_at) VALUES ($1, $2, $3, now() + interval '1 day'), ($4, $5, $6, now() + interval '1 day')",
			[randomUUID(), adminSessionToken, adminUserId, randomUUID(), nonAdminSessionToken, nonAdminId]
		);
		await database.query('INSERT INTO public.games (app_id, title, slug) VALUES ($1, $2, $3)', [
			appId,
			`Report fixture ${suffix}`,
			slug
		]);
		gameCreated = true;
		const initialStates = [...Array(12).fill('pending'), 'published', 'hidden', 'removed'];
		for (let index = 0; index < reportIds.length; index += 1) {
			await database.query(
				`INSERT INTO public.native_reports
				 (id, app_id, author_id, verdict, platform, content, moderation_state, created_at, published_at,
				  device_name_snapshot, gpu, gpu_vendor, distribution, proton_version, performance_notes, known_issues, launch_options)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, now() - ($8::int * interval '1 second'),
				         CASE WHEN $7 = 'published' THEN now() ELSE NULL END,
				         'Gaming PC', 'Radeon Fixture', 'AMD', 'SteamOS Fixture', 'GE-Proton 9-20',
				         'Stable at 60 FPS', 'No known issues', 'gamemoderun %command%')`,
				[
					reportIds[index],
					appId,
					authorId,
					index === 1 ? 'no' : 'yes',
					index === 1 ? 'steam_deck' : 'linux_desktop',
					index === 0
						? `Safe fixture ${suffix}: <img src=x onerror=alert(1)>`
						: `Public fixture report ${index}`,
					initialStates[index],
					index
				]
			);
		}

		const guest = await page.request.get('/settings/reports', { maxRedirects: 0 });
		expect(guest.status()).toBe(303);
		expect(guest.headers().location).toBe('/login');
		const guestPost = await page.request.post('/settings/reports?/moderate', {
			form: { id: reportIds[0], expectedState: 'pending', action: 'review' },
			headers: { origin: baseURL!, accept: 'text/html' },
			maxRedirects: 0
		});
		expect(guestPost.status()).toBe(303);

		const securePrefix = process.env.NODE_ENV === 'production' ? '__Secure-' : '';
		const cookieName = `${securePrefix}vapourdb.session_token`;
		const nonAdminContext = await browser.newContext({ baseURL });
		try {
			await nonAdminContext.addCookies([
				{
					name: cookieName,
					value: encodeURIComponent(`${nonAdminSessionToken}.${nonAdminSignature}`),
					url: baseURL!
				}
			]);
			const nonAdminResponse = await nonAdminContext.request.get(
				`/settings/reports?steamId=${allowlistedSteamId}`
			);
			expect(nonAdminResponse.status()).toBe(404);
			const forbiddenPost = await nonAdminContext.request.post(
				`/settings/reports?/moderate&steamId=${allowlistedSteamId}`,
				{
					form: { id: reportIds[0], expectedState: 'pending', action: 'review' },
					headers: { origin: baseURL!, accept: 'text/html' }
				}
			);
			expect(forbiddenPost.status()).toBe(404);
		} finally {
			await nonAdminContext.close();
		}

		await page.context().addCookies([
			{
				name: cookieName,
				value: encodeURIComponent(`${adminSessionToken}.${adminSignature}`),
				url: baseURL!
			}
		]);
		const profileResponse = await page.request.get(`/users/${authorUsername}`);
		expect(profileResponse.status()).toBe(200);
		expect(profileResponse.headers()['cache-control']).toBe('private, no-store');
		const profileHtml = await profileResponse.text();
		expect(profileHtml).not.toContain(`${suffix}-author@steam.invalid`);
		expect(profileHtml).not.toContain(adminSessionToken);
		expect(profileHtml).not.toContain('moderationState');
		await page.goto(`/users/${authorUsername}`);
		await expect(page.getByRole('heading', { name: 'Community Reports' })).toBeVisible();
		await expect(page.getByText('public VapourDB reports').locator('..')).toContainText('13');
		await expect(
			page.getByRole('link', { name: `Report fixture ${suffix}` }).first()
		).toHaveAttribute('href', `/games/${appId}/${slug}`);
		await expect(page.getByText('Radeon Fixture', { exact: false }).first()).toBeVisible();
		await expect(page.getByText('GE-Proton 9-20', { exact: true }).first()).toBeVisible();
		await expect(page.getByText('Stable at 60 FPS', { exact: true }).first()).toBeVisible();
		await expect(page.locator('img[src="x"]')).toHaveCount(0);
		expect(await page.locator('body').innerText()).not.toMatch(/pending|published|hidden|removed/i);
		await page.getByRole('link', { name: 'Next →' }).click();
		await expect(page).toHaveURL(new RegExp(`/users/${authorUsername}\\?page=2`));
		await expect(page.getByText('Public fixture report 10', { exact: true })).toBeVisible();
		await expect(page.getByText('Public fixture report 13', { exact: true })).toHaveCount(0);
		await expect(page.getByText('Public fixture report 14', { exact: true })).toHaveCount(0);
		await page.goto(`/users/${emptyUsername}`);
		await expect(page.getByRole('heading', { name: 'No community reports yet' })).toBeVisible();
		expect(await page.locator('meta[name="robots"]').getAttribute('content')).toContain('noindex');

		const adminReportsUrl = `/settings/reports?filter=all&userId=${encodeURIComponent(authorId)}`;
		await page.goto('/settings/users');
		const userRow = page.locator('tr').filter({ hasText: authorUsername });
		const viewReports = userRow.getByRole('link', { name: 'View reports' });
		await expect(viewReports).toHaveAttribute(
			'href',
			`/settings/reports?filter=all&userId=${encodeURIComponent(authorId)}`
		);
		await viewReports.click();
		await expect(page).toHaveURL(adminReportsUrl);
		const adminResponse = await page.goto(adminReportsUrl);
		expect(adminResponse?.headers()['cache-control']).toBe('private, no-store');
		expect(adminResponse?.headers()['x-robots-tag']).toBe('noindex, nofollow');
		const adminHtml = await adminResponse?.text();
		expect(adminHtml).not.toContain(`${suffix}-author@steam.invalid`);
		expect(adminHtml).not.toContain(adminSessionToken);
		await expect(page.getByRole('heading', { name: 'Report Moderation' })).toBeVisible();
		await expect(page.getByText('Unreviewed reports are already public.')).toBeVisible();
		const publicSummary = page.getByText('Public', { exact: true }).locator('..');
		await expect(publicSummary).toContainText(/\d+/);
		await expect(publicSummary).toContainText('Pending + published');
		const report0 = page.locator(`[data-report-id="${reportIds[0]}"]`);
		await expect(report0.getByText('pending', { exact: true })).toBeVisible();
		await report0.getByRole('button', { name: 'Mark reviewed' }).click();
		await expect(report0.getByText('published', { exact: true })).toBeVisible();
		const report12 = page.locator(`[data-report-id="${reportIds[12]}"]`);
		await report12.getByRole('button', { name: 'Hide' }).click();
		await expect(report12.getByText('hidden', { exact: true })).toBeVisible();
		await report12.getByRole('button', { name: 'Restore' }).click();
		await expect(report12.getByText('published', { exact: true })).toBeVisible();
		const report13 = page.locator(`[data-report-id="${reportIds[13]}"]`);
		await report13.getByRole('button', { name: 'Restore' }).click();
		await expect(report13.getByText('published', { exact: true })).toBeVisible();
		const report14 = page.locator(`[data-report-id="${reportIds[14]}"]`);
		await report14.getByLabel('Confirm restoration of removed report').check();
		await report14.getByRole('button', { name: 'Restore report' }).click();
		await expect(report14.getByText('published', { exact: true })).toBeVisible();
		await report14.getByLabel('Confirm removal').check();
		await report14.getByRole('button', { name: 'Remove report' }).click();
		await expect(report14.getByText('removed', { exact: true })).toBeVisible();

		await page.getByLabel('Search username, game title, or Steam AppID').fill(appId);
		await page.getByRole('button', { name: 'Apply filters' }).click();
		await expect(page.getByText('15 matching reports')).toBeVisible();
		await page.getByLabel('Report state').selectOption('pending');
		await page.getByLabel('Search username, game title, or Steam AppID').fill(authorUsername);
		await page.getByRole('button', { name: 'Apply filters' }).click();
		const pendingReports = page.locator('[data-report-id]');
		await expect(pendingReports.first()).toContainText('Public fixture report 11');

		await page.goto(`/users/${authorUsername}`);
		await expect(page.getByText('public VapourDB reports').locator('..')).toContainText('14');
		await expect(page.locator('body')).toContainText('Safe fixture');
		const storedState = await database.query(
			' SELECT moderation_state FROM public.native_reports WHERE id = $1',
			[reportIds[0]]
		);
		expect(storedState.rows[0]?.moderation_state).toBe('published');
	} finally {
		await page.context().clearCookies();
		if (fixturesCreated) {
			await database.query('DELETE FROM public.native_reports WHERE id = ANY($1::uuid[])', [
				reportIds
			]);
			if (gameCreated) await database.query('DELETE FROM public.games WHERE app_id = $1', [appId]);
			await database.query('DELETE FROM public.session WHERE token = ANY($1::text[])', [
				[adminSessionToken, nonAdminSessionToken]
			]);
			await database.query('DELETE FROM public."user" WHERE id = ANY($1::text[])', [
				[authorId, emptyUserId, nonAdminId]
			]);
		}
		if (createdAdmin && adminUserId) {
			await database.query('DELETE FROM public.account WHERE user_id = $1', [adminUserId]);
			await database.query('DELETE FROM public."user" WHERE id = $1', [adminUserId]);
		}
		await database.end();
	}
});
