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
