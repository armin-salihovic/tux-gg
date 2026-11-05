import { describe, expect, it } from 'vitest';
import { nativeReportSchema } from './native-report-validation.js';

const valid = {
	id: 'a83d97d6-60b4-4c01-a395-3a5470317e4d',
	verdict: 'yes',
	platform: 'steam_deck',
	content: 'Runs smoothly for several hours.'
};

describe('native report validation', () => {
	it('accepts the required verdict, platform, and experience', () => {
		expect(nativeReportSchema.safeParse(valid).success).toBe(true);
	});

	it.each([
		{ verdict: 'maybe' },
		{ verdict: '' },
		{ platform: 'steam_os' },
		{ platform: '' },
		{ content: '' },
		{ content: 'short' },
		{ content: 'x'.repeat(5001) },
		{ protonVersion: 'x'.repeat(101) },
		{ distribution: 'x'.repeat(121) },
		{ gpuVendor: 'Other' }
	])('rejects invalid field values %#', (override) => {
		expect(nativeReportSchema.safeParse({ ...valid, ...override }).success).toBe(false);
	});

	it('normalizes blank optional fields to undefined and trims submitted text', () => {
		const parsed = nativeReportSchema.parse({
			...valid,
			content: '  Great on Linux.  ',
			cpu: '',
			gpu: ' RX 6800 '
		});
		expect(parsed.content).toBe('Great on Linux.');
		expect(parsed.cpu).toBeUndefined();
		expect(parsed.gpu).toBe('RX 6800');
	});

	it('discards client-supplied author and moderation fields', () => {
		const parsed = nativeReportSchema.parse({
			...valid,
			authorId: 'someone-else',
			moderationState: 'published'
		});
		expect(parsed).not.toHaveProperty('authorId');
		expect(parsed).not.toHaveProperty('moderationState');
	});
});
