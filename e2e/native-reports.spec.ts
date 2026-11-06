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
	browser,
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
		await page.goto('/settings/devices');
		await expect(page).toHaveURL('/login');
		await expect(page.getByRole('heading', { name: 'Sign in through Steam' })).toBeVisible();
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
		await expect(
			page.getByText(
				'Add a Linux PC or Steam Deck to your account before writing a compatibility report.'
			)
		).toBeVisible();
		for (let attempt = 0; attempt < 6; attempt += 1) {
			const blockedReport = await page.request.post(formPath, {
				form: {
					id: randomUUID(),
					verdict: 'yes',
					deviceId: randomUUID(),
					content: 'A forged report without a saved device.'
				}
			});
			expect(blockedReport.status()).toBe(403);
		}
		await expect(page.getByRole('button', { name: 'Submit report' })).toHaveCount(0);
		await page.getByRole('link', { name: 'Add Device' }).click();
		await expect(page).toHaveURL(new RegExp('/settings/devices/new\\?returnTo='));
		const windowsInfo = `Computer Information:\nManufacturer: Microsoft\nModel: Windows PC\nProcessor Information:\nCPU Brand: Intel Core i7-12700K\nOperating System:\nWindows 11 (64 bit)\nVideo Card:\nDriver: NVIDIA GeForce RTX 4070\nMemory:\nRAM: 32 GB`;
		await page.getByLabel('Device name').fill('Windows PC');
		await page.getByRole('textbox', { name: 'Steam System Information' }).fill(windowsInfo);
		await page.getByRole('button', { name: 'Detect System Information' }).click();
		await expect(page.getByRole('alert')).toContainText(
			'This system information appears to come from Windows'
		);
		await expect(page.getByRole('button', { name: 'Save device' })).toBeDisabled();
		const windowsSave = await page.request.post('/settings/devices/new?/save', {
			form: { name: 'Forged Windows PC', systemInfo: windowsInfo }
		});
		expect(windowsSave.status()).toBe(400);
		const malformedSave = await page.request.post('/settings/devices/new?/save', {
			form: { name: 'Malformed import', systemInfo: 'some random text with a GPU' }
		});
		expect(malformedSave.status()).toBe(400);
		expect(
			(
				await web.query(
					'SELECT count(*)::int AS count FROM public.user_devices WHERE user_id = $1',
					[userId]
				)
			).rows[0]?.count
		).toBe(0);

		const legacyDeviceId = randomUUID();
		await web.query(
			`INSERT INTO public.user_devices (id, user_id, name, device_type, cpu, gpu, gpu_vendor, is_default)
			 VALUES ($1, $2, 'Old manual PC', 'linux_desktop', 'Unverified CPU', 'Unverified GPU', 'AMD', false)`,
			[legacyDeviceId, userId]
		);
		await page.goto(formPath);
		await expect(
			page.getByRole('heading', { name: 'Reimport a saved device to write this report' })
		).toBeVisible();
		await page.getByRole('link', { name: 'Reimport Steam System Information' }).click();
		await expect(page).toHaveURL(
			new RegExp(`/settings/devices/${legacyDeviceId}/edit\\?returnTo=`)
		);
		const cachyInfo = `Computer Information:\nManufacturer: Gigabyte Technology Co., Ltd.\nModel: B850M DS3H\nProcessor Information:\nCPU Brand: AMD Ryzen 7 9800X3D 8-Core Processor\nOperating System:\nCachyOS (64 bit)\nKernel Name: Linux\nKernel Version: 7.3\nVideo Card:\nDriver: AMD AMD Radeon RX 9070 XT (radeonsi, gfx1201, ACO, DRM 3.64)\nDriver Version: 4.6 (Compatibility Profile) Mesa 26.2.6-arch3.1\nMemory:\nRAM: 31188 Mb`;
		await page.getByRole('textbox', { name: 'Steam System Information' }).fill(cachyInfo);
		await page.getByRole('button', { name: 'Detect System Information' }).click();
		await expect(page.getByText('AMD Ryzen 7 9800X3D', { exact: true })).toBeVisible();
		await expect(page.getByText('AMD Radeon RX 9070 XT', { exact: true })).toBeVisible();
		await expect(page.getByText('30.5 GiB', { exact: true })).toBeVisible();
		await expect(page.getByText('CachyOS', { exact: true })).toBeVisible();
		await expect(page.getByText('Linux desktop', { exact: true })).toBeVisible();
		await expect(page.getByLabel('CPU', { exact: true })).toHaveCount(0);
		await expect(
			page.locator('input[name="cpu"], input[name="gpu"], select[name="deviceType"]')
		).toHaveCount(0);
		await page.getByRole('button', { name: 'Save device' }).click();
		await expect(page).toHaveURL(formPath);
		const legacyAfterReimport = await web.query(
			'SELECT source_verified_at, cpu, gpu, distribution FROM public.user_devices WHERE id = $1',
			[legacyDeviceId]
		);
		expect(legacyAfterReimport.rows[0]).toMatchObject({
			source_verified_at: expect.any(Date),
			cpu: 'AMD Ryzen 7 9800X3D',
			gpu: 'AMD Radeon RX 9070 XT',
			distribution: 'CachyOS'
		});

		await page.goto('/settings/devices/new?returnTo=' + encodeURIComponent(formPath));
		await page.getByLabel('Device name').fill('Main Gaming PC');
		await page.getByRole('textbox', { name: 'Steam System Information' }).fill(cachyInfo);
		await page.getByRole('button', { name: 'Detect System Information' }).click();
		await expect(page.getByText('Hardware detected')).toBeVisible();
		await page.getByRole('button', { name: 'Save device' }).click();
		await expect(page).toHaveURL(formPath);
		const mainDeviceResult = await web.query(
			"SELECT id, device_type, cpu, gpu, gpu_vendor, ram, distribution, kernel, graphics_driver, source_verified_at FROM public.user_devices WHERE user_id = $1 AND name = 'Main Gaming PC'",
			[userId]
		);
		const mainDevice = mainDeviceResult.rows[0];
		expect(mainDevice).toMatchObject({
			device_type: 'linux_desktop',
			cpu: 'AMD Ryzen 7 9800X3D',
			gpu: 'AMD Radeon RX 9070 XT',
			gpu_vendor: 'AMD',
			ram: '30.5 GiB',
			distribution: 'CachyOS',
			kernel: '7.3',
			graphics_driver: 'Mesa 26.2.6-arch3.1',
			source_verified_at: expect.any(Date)
		});

		await page.goto('/settings/devices/new');
		await page.getByLabel('Device name').fill('Steam Deck OLED');
		const deckSystemInfo = page.getByRole('textbox', { name: 'Steam System Information' });
		await page.getByLabel('Upload Steam System Information text file').setInputFiles({
			name: 'steam-deck.txt',
			mimeType: 'text/plain',
			buffer: Buffer.from(
				'Computer Information:\nManufacturer: Valve\nModel: Galileo\nOperating System:\nSteamOS Holo (64 bit)\nProcessor Information:\nCPU Brand: AMD Custom APU 0406\nVideo Card:\nDriver: AMD AMD Custom GPU 0406 (RADV VANGOGH)\nMemory:\nRAM: 16384 Mb'
			)
		});
		await expect(deckSystemInfo).toHaveValue(/SteamOS Holo/);
		await page.getByRole('button', { name: 'Detect System Information' }).click();
		await expect(page.getByText('Steam Deck', { exact: true })).toBeVisible();
		await page.getByRole('button', { name: 'Save device' }).click();
		await expect(page).toHaveURL('/settings/devices?saved=1');
		const deckDeviceResult = await web.query(
			"SELECT id FROM public.user_devices WHERE user_id = $1 AND name = 'Steam Deck OLED'",
			[userId]
		);
		const deckDeviceId = deckDeviceResult.rows[0]?.id as string;
		await page.goto('/settings/devices');
		const ordinaryContext = await browser.newContext({ javaScriptEnabled: false });
		try {
			await ordinaryContext.addCookies(await page.context().cookies());
			const ordinaryPage = await ordinaryContext.newPage();
			await ordinaryPage.goto(new URL('/settings/devices', baseURL!).toString());
			const ordinaryDeckCard = ordinaryPage.locator('article').filter({
				hasText: 'Steam Deck OLED'
			});
			await ordinaryDeckCard.getByRole('button', { name: 'Set default' }).click();
			await expect(ordinaryPage).toHaveURL('/settings/devices?saved=1');
			await expect(ordinaryPage.getByRole('status')).toContainText('saved');
			await expect(ordinaryDeckCard.getByText('Default device')).toBeVisible();
			await expect(
				ordinaryPage
					.locator('article')
					.filter({ hasText: 'Main Gaming PC' })
					.getByText('Default device')
			).toHaveCount(0);
		} finally {
			await ordinaryContext.close();
		}

		await page.goto('/settings/devices');
		const mainCard = page.locator('article').filter({ hasText: 'Main Gaming PC' });
		const deckCard = page.locator('article').filter({ hasText: 'Steam Deck OLED' });
		await mainCard.getByRole('button', { name: 'Set default' }).click();
		await expect(page.getByRole('status')).toContainText('saved');
		await deckCard.getByRole('button', { name: 'Set default' }).click();
		await expect(page.getByRole('status')).toContainText('saved');
		await expect(deckCard.getByText('Default device')).toBeVisible();
		await expect(mainCard.getByText('Default device')).toHaveCount(0);

		await page.goto(formPath);
		await expect(page.getByRole('heading', { name: 'Write a report' })).toBeVisible();
		await page.getByLabel('Compatibility verdict').selectOption('yes');
		await expect(page.getByLabel('Which device did you play on?')).toHaveValue(deckDeviceId);
		await page.getByLabel('Which device did you play on?').selectOption(mainDevice.id);
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
				['moderationState', 'published'],
				['cpu', 'Forged CPU'],
				['gpu', 'Forged GPU'],
				['ram', '999 GB']
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
			'SELECT author_id, moderation_state, platform, device_id, device_name_snapshot, cpu, gpu, gpu_vendor, ram, distribution, kernel, graphics_driver FROM public.native_reports WHERE id = $1',
			[reportId]
		);
		expect(stored.rows[0]).toEqual({
			author_id: userId,
			moderation_state: 'pending',
			platform: 'linux_desktop',
			device_id: mainDevice.id,
			device_name_snapshot: 'Main Gaming PC',
			cpu: 'AMD Ryzen 7 9800X3D',
			gpu: 'AMD Radeon RX 9070 XT',
			gpu_vendor: 'AMD',
			ram: '30.5 GiB',
			distribution: 'CachyOS',
			kernel: '7.3',
			graphics_driver: 'Mesa 26.2.6-arch3.1'
		});

		await page.goto(formPath);
		await page.getByLabel('Compatibility verdict').selectOption('yes');
		await page.getByLabel('Which device did you play on?').selectOption(mainDevice.id);
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
		const publishedReport = page.locator('article').filter({ hasText: `@${username}` });
		await expect(publishedReport).toHaveCount(1);
		await expect(page.getByRole('link', { name: `@${username}` })).toHaveAttribute(
			'href',
			`/users/${username}`
		);
		await expect(page.getByText(unsafeLookingText, { exact: true })).toBeVisible();
		await expect(page.locator('img[src="x"]')).toHaveCount(0);
		await expect(publishedReport.getByRole('heading', { name: 'Main Gaming PC' })).toBeVisible();
		await expect(
			publishedReport.getByText('AMD Radeon RX 9070 XT', { exact: false })
		).toBeVisible();

		await page.goto(`/settings/devices/${mainDevice.id}/edit`);
		const refreshedInfo = cachyInfo
			.replace('Ryzen 7 9800X3D', 'Ryzen 9 9900X')
			.replace('RX 9070 XT', 'RX 10070 XT');
		await page.getByRole('textbox', { name: 'Steam System Information' }).fill(refreshedInfo);
		await page.getByRole('button', { name: 'Detect System Information' }).click();
		await expect(page.getByText('AMD Radeon RX 10070 XT', { exact: true })).toBeVisible();
		await page.getByRole('button', { name: 'Save device' }).click();
		await expect(page).toHaveURL('/settings/devices?saved=1');
		await page.goto(gamePath);
		await expect(
			publishedReport.getByText('AMD Radeon RX 9070 XT', { exact: false })
		).toBeVisible();
		await expect(publishedReport.getByText('AMD Radeon RX 10070 XT', { exact: false })).toHaveCount(
			0
		);

		const ordinaryDeleteContext = await browser.newContext({ javaScriptEnabled: false });
		try {
			await ordinaryDeleteContext.addCookies(await page.context().cookies());
			const ordinaryDeletePage = await ordinaryDeleteContext.newPage();
			await ordinaryDeletePage.goto(new URL('/settings/devices', baseURL!).toString());
			const ordinaryDeckCard = ordinaryDeletePage.locator('article').filter({
				hasText: 'Steam Deck OLED'
			});
			await ordinaryDeckCard.getByRole('button', { name: 'Delete' }).click();
			await expect(ordinaryDeletePage).toHaveURL('/settings/devices?saved=1');
			await expect(
				ordinaryDeletePage.locator('article').filter({ hasText: 'Steam Deck OLED' })
			).toHaveCount(0);
			await expect(
				ordinaryDeletePage
					.locator('article')
					.filter({ hasText: 'Old manual PC' })
					.getByText('Default device')
			).toBeVisible();
		} finally {
			await ordinaryDeleteContext.close();
		}

		await page.goto('/settings/devices');
		page.once('dialog', (dialog) => dialog.accept());
		await mainCard.getByRole('button', { name: 'Delete' }).click();
		await expect(page).toHaveURL('/settings/devices?saved=1');
		const preserved = await web.query(
			'SELECT device_id, device_name_snapshot, gpu FROM public.native_reports WHERE id = $1',
			[reportId]
		);
		expect(preserved.rows[0]).toEqual({
			device_id: null,
			device_name_snapshot: 'Main Gaming PC',
			gpu: 'AMD Radeon RX 9070 XT'
		});
		await page.goto(gamePath);
		await expect(publishedReport.getByRole('heading', { name: 'Main Gaming PC' })).toBeVisible();
		await expect(
			publishedReport.getByText('AMD Radeon RX 9070 XT', { exact: false })
		).toBeVisible();
		await page.goto('/settings/devices');
		const legacyCard = page.locator('article').filter({ hasText: 'Old manual PC' });
		page.once('dialog', (dialog) => dialog.accept());
		await legacyCard.getByRole('button', { name: 'Delete' }).click();
		await expect(page).toHaveURL('/settings/devices?saved=1');
		await page.goto(formPath);
		await expect(
			page.getByText(
				'Add a Linux PC or Steam Deck to your account before writing a compatibility report.'
			)
		).toBeVisible();
		await expect(page.getByRole('button', { name: 'Submit report' })).toHaveCount(0);
	} finally {
		await web.end();
	}
});
