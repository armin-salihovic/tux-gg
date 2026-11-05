import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Pool } from 'pg';
import { expect, test } from '@playwright/test';

const webDatabaseUrl = process.env.DATABASE_URL;
const operatorDatabaseUrl = process.env.MIGRATION_DATABASE_URL;
const webDatabaseName = webDatabaseUrl ? new URL(webDatabaseUrl).pathname.slice(1) : '';
const operatorDatabaseName = operatorDatabaseUrl
	? new URL(operatorDatabaseUrl).pathname.slice(1)
	: '';

test.skip(
	webDatabaseName !== 'tuxgg_test' || operatorDatabaseName !== 'tuxgg_test',
	'Native report browser journey requires the disposable tuxgg_test database.'
);

test('Steam user submits a pending report, views it privately, then sees it after operator approval', async ({
	page,
	baseURL
}) => {
	if (!webDatabaseUrl || !operatorDatabaseUrl) throw new Error('Test database URLs are missing.');
	const secret = process.env.BETTER_AUTH_SECRET;
	if (!secret)
		throw new Error('A CI-only Better Auth secret is required for the simulated session.');

	const web = new Pool({ connectionString: webDatabaseUrl });
	try {
		const identity = await web.query('SELECT current_database(), current_user');
		expect(identity.rows[0]?.current_database).toBe('tuxgg_test');
		const marker = await web.query(
			'SELECT marker FROM public.tuxgg_test_safety_marker WHERE id = 1'
		);
		expect(marker.rows[0]?.marker).toBe('tuxgg_disposable_test_database_v1');

		const gamePath = '/games/440/team-fortress-2';
		const formPath = `${gamePath}/report/new`;
		await page.goto(gamePath);
		const writeReport = page.getByRole('link', { name: 'Write a Report' });
		await expect(writeReport).toHaveAttribute('href', formPath);
		await writeReport.click();
		await expect(page).toHaveURL(new RegExp(`/login\\?returnTo=${encodeURIComponent(formPath)}`));
		await expect(page.getByRole('heading', { name: 'Sign in through Steam' })).toBeVisible();

		const suffix = randomUUID();
		const userId = `e2e-steam-${suffix}`;
		const accountId = `7656119${randomBytes(5).toString('hex').replace(/[a-f]/g, '1').slice(0, 10)}`;
		const username = `e2e-${suffix.slice(0, 18)}`;
		const email = `${suffix}@steam.invalid`;
		const token = randomBytes(32).toString('base64url');
		const signature = createHmac('sha256', secret).update(token).digest('base64');
		await web.query('INSERT INTO public.user (id, name, email, username) VALUES ($1, $2, $3, $4)', [
			userId,
			'E2E Steam player',
			email,
			username
		]);
		await web.query(
			'INSERT INTO public.account (id, account_id, provider_id, user_id) VALUES ($1, $2, $3, $4)',
			[`${userId}-steam`, accountId, 'steam', userId]
		);
		await web.query(
			"INSERT INTO public.session (id, token, user_id, expires_at) VALUES ($1, $2, $3, now() + interval '1 day')",
			[randomUUID(), token, userId]
		);

		const securePrefix = process.env.NODE_ENV === 'production' ? '__Secure-' : '';
		await page.context().addCookies([
			{
				name: `${securePrefix}tuxgg.session_token`,
				value: encodeURIComponent(`${token}.${signature}`),
				url: baseURL!
			}
		]);
		await page.goto(formPath);
		await expect(page.getByRole('heading', { name: 'Write a report' })).toBeVisible();
		await page.getByLabel('Compatibility verdict').selectOption('yes');
		await page.getByLabel('Platform').selectOption('steam_deck');
		await page.getByLabel('Your experience').fill('short');
		await page.locator('form').evaluate((form) => {
			(form as HTMLFormElement).noValidate = true;
		});
		await page.getByRole('button', { name: 'Submit report' }).click();
		await expect(page.getByRole('alert')).toContainText(
			'Check the highlighted fields and try again.'
		);
		await expect(page).toHaveURL(formPath);

		const unsafeLookingText = `Browser journey ${suffix}: <img src=x onerror=alert(1)>`;
		await page.getByLabel('Your experience').fill(unsafeLookingText);
		await page.getByLabel('Proton version', { exact: true }).fill('GE-Proton 9-20');
		const reportId = await page.locator('input[name="id"]').inputValue();
		await page.locator('form').evaluate((form) => {
			for (const [name, value] of [
				['authorId', 'forged-other-user'],
				['moderationState', 'published']
			]) {
				const field = document.createElement('input');
				field.type = 'hidden';
				field.name = name;
				field.value = value;
				form.append(field);
			}
		});
		await page.getByRole('button', { name: 'Submit report' }).click();
		await expect(page).toHaveURL('/my-reports?submitted=1');
		await expect(page.getByRole('status')).toContainText('submitted for review');
		await expect(page.getByText('Pending review')).toBeVisible();
		await expect(page.getByRole('link', { name: 'Team Fortress 2', exact: true })).toHaveAttribute(
			'href',
			gamePath
		);
		const stored = await web.query(
			'SELECT author_id, moderation_state FROM public.native_reports WHERE id = $1',
			[reportId]
		);
		expect(stored.rows[0]).toEqual({ author_id: userId, moderation_state: 'pending' });

		await page.goto(formPath);
		await page.getByLabel('Compatibility verdict').selectOption('yes');
		await page.getByLabel('Platform').selectOption('steam_deck');
		await page.getByLabel('Your experience').fill('This exact form submission was already saved.');
		await page.locator('input[name="id"]').evaluate((input, existingId) => {
			(input as HTMLInputElement).value = existingId;
		}, reportId);
		await page.getByRole('button', { name: 'Submit report' }).click();
		await expect(page.getByRole('alert')).toContainText(
			'This form was already submitted. Reload the page to start another report.'
		);
		const duplicateCount = await web.query(
			'SELECT count(*)::int AS count FROM public.native_reports WHERE id = $1',
			[reportId]
		);
		expect(duplicateCount.rows[0]?.count).toBe(1);

		await page.goto(gamePath);
		await expect(page.getByRole('heading', { name: 'Player-submitted reports' })).toBeVisible();
		await expect(page.getByText(unsafeLookingText, { exact: true })).toHaveCount(0);
		await expect(page.locator('img[src="x"]')).toHaveCount(0);

		const output = execFileSync(
			'python',
			['scripts/moderate_native_reports.py', 'approve', reportId],
			{
				cwd: process.cwd(),
				encoding: 'utf8',
				env: { ...process.env, NATIVE_REPORT_OPERATOR_DATABASE_URL: operatorDatabaseUrl }
			}
		);
		expect(output).toContain('set to published');
		await page.goto('/my-reports');
		await expect(page.getByText('Published', { exact: true })).toBeVisible();
		await page.goto(gamePath);
		await page.reload();
		await expect(page.getByRole('link', { name: `@${username}` })).toHaveAttribute(
			'href',
			`/users/${username}`
		);
		await expect(page.getByText(unsafeLookingText, { exact: true })).toBeVisible();
		await expect(page.locator('img[src="x"]')).toHaveCount(0);
	} finally {
		await web.end();
	}
});
