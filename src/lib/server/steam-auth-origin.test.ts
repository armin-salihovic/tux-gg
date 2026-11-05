import { describe, expect, it } from 'vitest';
import { getTrustedSiteOrigin } from './steam-auth.js';

describe('trusted Steam site origin', () => {
	it('accepts matching production origins and Better Auth base paths', () => {
		expect(
			getTrustedSiteOrigin('https://tuxgg.example', 'https://tuxgg.example/api/auth', '/api/auth')
		).toBe('https://tuxgg.example');
	});

	it('supports localhost development on configured ports', () => {
		expect(
			getTrustedSiteOrigin('http://localhost:5174', 'http://localhost:5174/api/auth', '/api/auth')
		).toBe('http://localhost:5174');
	});

	it.each([
		{
			label: 'malformed site URL',
			siteURL: 'not a URL',
			internalBaseURL: 'https://tuxgg.example/api/auth'
		},
		{
			label: 'site URL with a path',
			siteURL: 'https://tuxgg.example/app',
			internalBaseURL: 'https://tuxgg.example/api/auth'
		},
		{
			label: 'site URL with a query',
			siteURL: 'https://tuxgg.example/?next=attacker',
			internalBaseURL: 'https://tuxgg.example/api/auth'
		},
		{
			label: 'untrusted Better Auth origin',
			siteURL: 'https://tuxgg.example',
			internalBaseURL: 'https://attacker.invalid/api/auth'
		},
		{
			label: 'Better Auth URL with credentials',
			siteURL: 'https://tuxgg.example',
			internalBaseURL: 'https://user:password@tuxgg.example/api/auth'
		},
		{
			label: 'unexpected Better Auth path',
			siteURL: 'https://tuxgg.example',
			internalBaseURL: 'https://tuxgg.example/other'
		},
		{
			label: 'HTTP outside localhost',
			siteURL: 'http://tuxgg.example',
			internalBaseURL: 'http://tuxgg.example/api/auth'
		}
	])('rejects $label', ({ siteURL, internalBaseURL }) => {
		expect(() => getTrustedSiteOrigin(siteURL, internalBaseURL, '/api/auth')).toThrow();
	});
});
