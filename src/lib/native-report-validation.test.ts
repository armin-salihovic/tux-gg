import { describe, expect, it } from 'vitest';
import { nativeReportSchema } from './native-report-validation.js';

const valid = {
	id: 'a83d97d6-60b4-4c01-a395-3a5470317e4d',
	deviceId: '39d35be0-8453-43cd-a9c3-b9f0c2a87f04',
	verdict: 'yes',
	content: 'Runs smoothly for several hours.'
};

describe('native report validation', () => {
	it('accepts the required verdict, saved device, and experience', () => {
		expect(nativeReportSchema.safeParse(valid).success).toBe(true);
	});

	it.each([
		{ verdict: 'maybe' },
		{ verdict: '' },
		{ deviceId: '' },
		{ deviceId: 'not-a-uuid' },
		{ content: '' },
		{ content: 'short' },
		{ content: 'x'.repeat(5001) },
		{ protonVersion: 'x'.repeat(101) },
		{ launchOptions: 'x'.repeat(1001) }
	])('rejects invalid field values %#', (override) => {
		expect(nativeReportSchema.safeParse({ ...valid, ...override }).success).toBe(false);
	});

	it('normalizes optional report fields and trims submitted text', () => {
		const parsed = nativeReportSchema.parse({
			...valid,
			content: '  Great on Linux.  ',
			protonVersion: ''
		});
		expect(parsed.content).toBe('Great on Linux.');
		expect(parsed.protonVersion).toBeUndefined();
	});

	it('discards client-supplied author, moderation, and hardware fields', () => {
		const parsed = nativeReportSchema.parse({
			...valid,
			authorId: 'someone-else',
			moderationState: 'published',
			cpu: 'Forged CPU',
			gpu: 'Forged GPU',
			ram: '999 GB'
		});
		expect(parsed).not.toHaveProperty('authorId');
		expect(parsed).not.toHaveProperty('moderationState');
		expect(parsed).not.toHaveProperty('cpu');
		expect(parsed).not.toHaveProperty('gpu');
		expect(parsed).not.toHaveProperty('ram');
	});
});
