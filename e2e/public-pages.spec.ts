import { expect, test } from '@playwright/test';

test('homepage renders search and security headers without a database', async ({ page }) => {
	const response = await page.goto('/');
	expect(response?.status()).toBe(200);
	expect(await response?.headerValue('x-content-type-options')).toBe('nosniff');
	expect(await response?.headerValue('x-frame-options')).toBe('DENY');
	await expect(page.getByRole('heading', { name: /know before you launch/i })).toBeVisible();
	await expect(page.getByRole('link', { name: /browse the catalog/i })).toBeVisible();
});

test('login page offers Steam-only sign-in and starts a mocked Steam handoff', async ({ page }) => {
	let loginRequests = 0;
	await page.route('**/api/auth/steam/login*', async (route) => {
		loginRequests += 1;
		const authorizationURL = new URL('https://steamcommunity.com/openid/login');
		authorizationURL.search = new URLSearchParams({
			'openid.mode': 'checkid_setup',
			'openid.realm': 'http://localhost:4179/',
			'openid.return_to': 'http://localhost:4179/api/auth/steam/callback?flow=flow&state=state'
		}).toString();
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ url: authorizationURL.toString() })
		});
	});
	await page.route('https://steamcommunity.com/**', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'text/html',
			body: '<!doctype html><html><body><h1>Mock Steam OpenID</h1></body></html>'
		});
	});
	await page.goto('/login');
	await page.waitForLoadState('networkidle');
	await expect(page.getByRole('heading', { name: 'Sign in through Steam' })).toBeVisible();
	await expect(
		page.getByText(
			'Sign in securely with your Steam account to create or access your TuxGG profile.'
		)
	).toBeVisible();
	await expect(page.getByRole('button', { name: 'Sign in through Steam' })).toBeVisible();
	await expect(page.getByRole('button', { name: /discord/i })).toHaveCount(0);
	await expect(
		page.getByRole('link', { name: /continue browsing without signing in/i })
	).toHaveAttribute('href', '/games');
	await page.getByRole('button', { name: 'Sign in through Steam' }).click();
	await expect(page).toHaveURL(
		/https:\/\/steamcommunity\.com\/openid\/login\?openid\.mode=checkid_setup/
	);
	await expect(page.getByRole('heading', { name: 'Mock Steam OpenID' })).toBeVisible();
	expect(loginRequests).toBe(1);
});

test('login page shows actionable errors for rejected and unavailable auth responses', async ({
	page
}) => {
	let loginRequests = 0;
	const cases = [
		{
			status: 403,
			body: JSON.stringify({ error: 'request_rejected' }),
			contentType: 'application/json',
			message: 'Sign-in request was rejected. Reload the page and try again.'
		},
		{
			status: 500,
			body: '<html>Internal server error</html>',
			contentType: 'text/html',
			message: 'Authentication service is temporarily unavailable. Try again shortly.'
		},
		{
			status: 503,
			body: JSON.stringify({ error: 'auth_not_configured' }),
			contentType: 'application/json',
			message:
				'Authentication is not configured. Check the local sign-in settings and restart the server.'
		}
	];

	for (const testCase of cases) {
		await page.route('**/api/auth/steam/login*', (route) => {
			loginRequests += 1;
			return route.fulfill({
				status: testCase.status,
				contentType: testCase.contentType,
				body: testCase.body
			});
		});
		await page.goto('/login');
		await page.waitForLoadState('networkidle');
		await page.getByRole('button', { name: 'Sign in through Steam' }).click();
		await expect.poll(() => loginRequests).toBeGreaterThan(0);
		await expect(page.getByRole('alert')).toHaveText(testCase.message);
		await page.unroute('**/api/auth/steam/login*');
	}
});

test('login page distinguishes a network failure from an HTTP error', async ({ page }) => {
	let loginRequests = 0;
	await page.route('**/api/auth/steam/login*', (route) => {
		loginRequests += 1;
		return route.abort('failed');
	});
	await page.goto('/login');
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: 'Sign in through Steam' }).click();
	await expect.poll(() => loginRequests).toBe(1);
	await expect(page.getByRole('alert')).toHaveText(
		'Could not reach the sign-in service. Check your connection and try again.'
	);
});

test('public policy pages are available and robots lists the sitemap', async ({ page }) => {
	await page.goto('/methodology');
	await expect(page.getByRole('heading', { name: 'TuxGG rating methodology' })).toBeVisible();
	const robots = await page.request.get('/robots.txt');
	expect(robots.status()).toBe(200);
	expect(await robots.text()).toContain('Sitemap: http://localhost:5173/sitemap.xml');
});

test('game pages render canonical Steam artwork and match sitemap indexability', async ({
	page
}) => {
	await page.route('https://shared.fastly.steamstatic.com/**', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'image/svg+xml',
			body: '<svg xmlns="http://www.w3.org/2000/svg" width="460" height="215"><rect width="460" height="215" fill="#67e8c2"/></svg>'
		});
	});
	const gameResponse = await page.goto('/games/440/team-fortress-2');
	expect(gameResponse?.status()).toBe(200);
	await expect(page.getByRole('heading', { name: 'Team Fortress 2', level: 1 })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Write a Report' })).toHaveAttribute(
		'href',
		'/games/440/team-fortress-2/report/new'
	);
	await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
		'href',
		'http://localhost:5173/games/440/team-fortress-2'
	);
	await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
		'content',
		'http://localhost:5173/og-default.png'
	);
	await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute(
		'content',
		'http://localhost:5173/og-default.png'
	);
	await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
		'content',
		'summary_large_image'
	);
	await expect(page.locator('meta[property="og:image:type"]')).toHaveAttribute(
		'content',
		'image/png'
	);
	await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute('content', '1200');
	await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute('content', '630');
	expect(await page.locator('meta[property="og:image"]').getAttribute('content')).not.toContain(
		'steamstatic.com'
	);
	const socialImage = await page.request.get('/og-default.png');
	expect(socialImage.status()).toBe(200);
	expect(socialImage.headers()['content-type']).toContain('image/png');
	const socialImageBytes = await socialImage.body();
	expect(socialImageBytes.readUInt32BE(16)).toBe(1200);
	expect(socialImageBytes.readUInt32BE(20)).toBe(630);
	await expect(
		page.locator('img[src*="shared.fastly.steamstatic.com"][src*="/440/header.jpg"]')
	).toHaveCount(1);
	const heroArtwork = page.locator('img[src*="/440/header.jpg"]');
	await expect(heroArtwork).toHaveAttribute('loading', 'eager');
	await expect(heroArtwork).toHaveAttribute('fetchpriority', 'high');
	await expect
		.poll(() => heroArtwork.evaluate((image: HTMLImageElement) => image.naturalWidth))
		.toBe(460);
	expect(await heroArtwork.evaluate((image) => getComputedStyle(image).opacity)).toBe('1');
	expect(await heroArtwork.evaluate((image) => image.className)).not.toContain('opacity-');
	await expect(page.locator('meta[name="robots"]')).toHaveCount(0);

	const sparseResponse = await page.goto('/games/730/counter-strike-2');
	expect(sparseResponse?.status()).toBe(200);
	await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex,follow');

	const sitemap = await page.request.get('/sitemap-games-0.xml');
	expect(sitemap.status()).toBe(200);
	const xml = await sitemap.text();
	expect(xml).toContain('http://localhost:5173/games/440/team-fortress-2');
	expect(xml).not.toContain('/games/730/counter-strike-2');
});

test('Steam artwork thumbnails render in a browser for the known app IDs', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const requested: string[] = [];
	await page.route('https://shared.fastly.steamstatic.com/**', async (route) => {
		requested.push(route.request().url());
		await route.fulfill({
			status: 200,
			contentType: 'image/svg+xml',
			body: '<svg xmlns="http://www.w3.org/2000/svg" width="616" height="353"><rect width="616" height="353" fill="#67e8c2"/></svg>'
		});
	});
	await page.goto('/');

	for (const appId of ['440', '570', '730']) {
		const card = page.locator(`a[href^="/games/${appId}/"]`).first();
		await card.scrollIntoViewIfNeeded();
		const image = card.locator('img');
		await expect(image).toHaveAttribute('src', new RegExp(`/apps/${appId}/capsule_616x353\\.jpg$`));
		await expect(image).toHaveAttribute('loading', 'lazy');
		await expect(image).toHaveAttribute('alt', '');
		await expect(image).toHaveAttribute('width', '616');
		await expect(image).toHaveAttribute('height', '353');
		await expect
			.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
			.toBe(616);
		const bounds = await image.evaluate((element: HTMLImageElement) => {
			const rect = element.parentElement!.getBoundingClientRect();
			return { width: rect.width, height: rect.height };
		});
		expect(bounds.width).toBeLessThanOrEqual(390);
		expect(bounds.height).toBeGreaterThan(0);
		expect(bounds.height / bounds.width).toBeCloseTo(353 / 616, 2);
	}
	for (const appId of ['440', '570', '730']) {
		expect(requested.some((url) => url.includes(`/apps/${appId}/capsule_616x353.jpg`))).toBe(true);
	}

	await page.goto('/games');
	for (const appId of ['440', '570', '730']) {
		const catalogCard = page.locator(`a[href^="/games/${appId}/"]`).first();
		await catalogCard.scrollIntoViewIfNeeded();
		const image = catalogCard.locator('img');
		await expect(image).toHaveAttribute('src', new RegExp(`/apps/${appId}/capsule_616x353\\.jpg$`));
		await expect
			.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
			.toBe(616);
		const bounds = await image.evaluate((element) => {
			const rect = element.parentElement!.getBoundingClientRect();
			return { width: rect.width, height: rect.height };
		});
		expect(bounds.height / bounds.width).toBeCloseTo(353 / 616, 2);
	}
});

test('Steam artwork uses one alternate after a 404 without shifting the hero layout', async ({
	page
}) => {
	const requested: string[] = [];
	let notifyHeaderRequest!: () => void;
	let allowHeader404!: () => void;
	const headerRequest = new Promise<void>((resolve) => (notifyHeaderRequest = resolve));
	const header404 = new Promise<void>((resolve) => (allowHeader404 = resolve));
	await page.route('https://shared.fastly.steamstatic.com/**', async (route) => {
		const url = route.request().url();
		requested.push(url);
		if (url.endsWith('/440/header.jpg')) {
			notifyHeaderRequest();
			await header404;
			await route.fulfill({ status: 404, body: 'missing' });
			return;
		}
		await route.fulfill({
			status: 200,
			contentType: 'image/svg+xml',
			body: '<svg xmlns="http://www.w3.org/2000/svg" width="460" height="215"><rect width="460" height="215" fill="#67e8c2"/></svg>'
		});
	});
	const navigation = page.goto('/games/440/team-fortress-2', { waitUntil: 'domcontentloaded' });
	await headerRequest;
	await navigation;
	const primaryHero = page.locator('img[src*="/440/header.jpg"]');
	const before = await primaryHero.evaluate((element) => {
		const rect = element.parentElement!.getBoundingClientRect();
		return { width: rect.width, height: rect.height };
	});
	allowHeader404();
	const hero = page.locator('img[src*="/440/capsule_616x353.jpg"]');
	await expect(hero).toHaveCount(1);
	await expect
		.poll(() => hero.evaluate((element: HTMLImageElement) => element.naturalWidth))
		.toBe(460);
	const bounds = await hero.evaluate((element) => {
		const rect = element.parentElement!.getBoundingClientRect();
		return { width: rect.width, height: rect.height };
	});
	expect(bounds.width).toBeGreaterThan(0);
	expect(bounds.height).toBeGreaterThan(0);
	expect(bounds.width).toBeCloseTo(before.width, 0);
	expect(bounds.height).toBeCloseTo(before.height, 0);
	expect(requested).toHaveLength(2);
	expect(requested[0]).toContain('/440/header.jpg');
	expect(requested[1]).toContain('/440/capsule_616x353.jpg');
});

test('Steam artwork stops after a network failure and shows the TuxGG fallback', async ({
	page
}) => {
	const requested: string[] = [];
	await page.route('https://shared.fastly.steamstatic.com/**', async (route) => {
		requested.push(route.request().url());
		await route.abort('failed');
	});
	await page.goto('/games/570/dota-2');
	await expect(page.locator('text=STEAM APP 570')).toBeVisible();
	await expect(page.locator('img[src*="/apps/570/"]')).toHaveCount(0);
	await expect.poll(() => requested.length).toBe(2);
	expect(requested[0]).toContain('/570/header.jpg');
	expect(requested[1]).toContain('/570/capsule_616x353.jpg');
});

test('changed game slugs redirect canonically and missing games return 404', async ({ page }) => {
	const redirect = await page.request.get('/games/440/old-slug', { maxRedirects: 0 });
	expect(redirect.status()).toBe(308);
	expect(redirect.headers().location).toBe('/games/440/team-fortress-2');
	const missing = await page.request.get('/games/999999999/unknown-game');
	expect(missing.status()).toBe(404);
});

test('account settings, My Reports, and report forms require sign-in', async ({ page }) => {
	const settings = await page.request.get('/settings', { maxRedirects: 0 });
	expect(settings.status()).toBe(303);
	expect(settings.headers().location).toBe('/login');
	const myReports = await page.request.get('/my-reports', { maxRedirects: 0 });
	expect(myReports.status()).toBe(303);
	expect(myReports.headers().location).toBe('/login?returnTo=%2Fmy-reports');
	const form = await page.request.get('/games/440/team-fortress-2/report/new', {
		maxRedirects: 0
	});
	expect(form.status()).toBe(303);
	expect(form.headers().location).toBe(
		'/login?returnTo=%2Fgames%2F440%2Fteam-fortress-2%2Freport%2Fnew'
	);
	const reportSubmission = await page.request.post('/games/440/team-fortress-2/report/new', {
		form: {
			id: '11111111-1111-4111-8111-111111111111',
			verdict: 'yes',
			platform: 'steam_deck',
			content: 'This guest must not submit a report.'
		},
		headers: { origin: 'http://127.0.0.1:4179' },
		maxRedirects: 0
	});
	expect(reportSubmission.status()).toBe(303);
	expect(reportSubmission.headers().location).toBe(
		'/login?returnTo=%2Fgames%2F440%2Fteam-fortress-2%2Freport%2Fnew'
	);
});

test('Write a Report remains visible within a mobile game page', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/games/440/team-fortress-2');
	const writeReport = page.getByRole('link', { name: 'Write a Report' });
	await expect(writeReport).toBeVisible();
	await expect(writeReport).toHaveAttribute('href', '/games/440/team-fortress-2/report/new');
	const bounds = await writeReport.boundingBox();
	expect(bounds).not.toBeNull();
	expect(bounds!.x).toBeGreaterThanOrEqual(0);
	expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
});
