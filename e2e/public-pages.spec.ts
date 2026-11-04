import { expect, test } from '@playwright/test';

test('homepage renders search and security headers without a database', async ({ page }) => {
	const response = await page.goto('/');
	expect(response?.status()).toBe(200);
	expect(await response?.headerValue('x-content-type-options')).toBe('nosniff');
	expect(await response?.headerValue('x-frame-options')).toBe('DENY');
	await expect(page.getByRole('heading', { name: /know before you launch/i })).toBeVisible();
	await expect(page.getByRole('link', { name: /browse the catalog/i })).toBeVisible();
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
	const gameResponse = await page.goto('/games/440/team-fortress-2');
	expect(gameResponse?.status()).toBe(200);
	await expect(page.getByRole('heading', { name: 'Team Fortress 2', level: 1 })).toBeVisible();
	await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
		'href',
		'http://localhost:5173/games/440/team-fortress-2'
	);
	await expect(
		page.locator('img[src*="shared.fastly.steamstatic.com"][src*="/440/header.jpg"]')
	).toHaveCount(1);
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

test('changed game slugs redirect canonically and missing games return 404', async ({ page }) => {
	const redirect = await page.request.get('/games/440/old-slug', { maxRedirects: 0 });
	expect(redirect.status()).toBe(308);
	expect(redirect.headers().location).toBe('/games/440/team-fortress-2');
	const missing = await page.request.get('/games/999999999/unknown-game');
	expect(missing.status()).toBe(404);
});

test('account settings require sign-in and native report publishing is unavailable', async ({
	page
}) => {
	const settings = await page.request.get('/settings', { maxRedirects: 0 });
	expect(settings.status()).toBe(303);
	expect(settings.headers().location).toBe('/login');
	const reportSubmission = await page.request.post('/api/reports', {
		data: { appId: '440', verdict: 'yes' }
	});
	expect(reportSubmission.status()).toBe(404);
});
