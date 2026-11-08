import { describe, expect, it } from 'vitest';
import { getTrustedSiteOrigin } from './steam-auth.js';

describe('trusted Steam site origin', () => {
	it('accepts matching production origins and Better Auth base paths', () => {
		expect(
			getTrustedSiteOrigin(
				'https://vapourdb.example',
				'https://vapourdb.example/api/auth',
				'/api/auth'
			)
		).toBe('https://vapourdb.example');
	});

	it('supports localhost development on configured ports', () => {
		expect(
			getTrustedSiteOrigin('http://localhost:5174', 'http://localhost:5174/api/auth', '/api/auth')
		).toBe('http://localhost:5174');
	});

	it('supports 127.0.0.1 development on configured ports', () => {
		expect(
			getTrustedSiteOrigin('http://127.0.0.1:5174', 'http://127.0.0.1:5174/api/auth', '/api/auth')
		).toBe('http://127.0.0.1:5174');
	});

	it.each([
		{
			label: 'malformed site URL',
			siteURL: 'not a URL',
			internalBaseURL: 'https://vapourdb.example/api/auth'
		},
		{
			label: 'site URL with a path',
			siteURL: 'https://vapourdb.example/app',
			internalBaseURL: 'https://vapourdb.example/api/auth'
		},
		{
			label: 'site URL with a query',
			siteURL: 'https://vapourdb.example/?next=attacker',
			internalBaseURL: 'https://vapourdb.example/api/auth'
		},
		{
			label: 'untrusted Better Auth origin',
			siteURL: 'https://vapourdb.example',
			internalBaseURL: 'https://attacker.invalid/api/auth'
		},
		{
			label: 'Better Auth URL with credentials',
			siteURL: 'https://vapourdb.example',
			internalBaseURL: 'https://user:password@vapourdb.example/api/auth'
		},
		{
			label: 'unexpected Better Auth path',
			siteURL: 'https://vapourdb.example',
			internalBaseURL: 'https://vapourdb.example/other'
		},
		{
			label: 'HTTP outside localhost',
			siteURL: 'http://vapourdb.example',
			internalBaseURL: 'http://vapourdb.example/api/auth'
		}
	])('rejects $label', ({ siteURL, internalBaseURL }) => {
		expect(() => getTrustedSiteOrigin(siteURL, internalBaseURL, '/api/auth')).toThrow();
	});
});
