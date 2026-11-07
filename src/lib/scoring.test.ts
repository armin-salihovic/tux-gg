import { describe, expect, it } from 'vitest';
import {
	MIN_EFFECTIVE_SAMPLE_SIZE,
	MIN_TOTAL_WEIGHT,
	recencyWeight,
	scoreCompatibility,
	tierForEvidence
} from './scoring.js';

describe('TuxGG native compatibility scoring', () => {
	const now = new Date('2026-01-01T00:00:00.000Z');
	const report = (verdict: 'yes' | 'no', daysAgo = 0) => ({
		verdict,
		createdAt: new Date(now.getTime() - daysAgo * 86_400_000),
		publishedAt: new Date(now.getTime() - daysAgo * 86_400_000)
	});

	it('requires at least three effective, recency-weighted published reports', () => {
		expect(scoreCompatibility([], now).tier).toBe('unknown');
		expect(tierForEvidence(1, 2.99, 5)).toBe('unknown');
		expect(tierForEvidence(1, 5, 2.99)).toBe('unknown');
		expect(tierForEvidence(1, MIN_TOTAL_WEIGHT, 3)).toBe('platinum');
		expect(tierForEvidence(1, 3, MIN_EFFECTIVE_SAMPLE_SIZE)).toBe('platinum');
		expect(tierForEvidence(1, 3, 3 - 2e-6)).toBe('unknown');
		expect(scoreCompatibility([report('yes'), report('yes'), report('yes')], now).tier).toBe(
			'platinum'
		);
	});

	it('maps published yes/no results to the historical tier thresholds', () => {
		expect(
			scoreCompatibility([report('yes'), report('yes'), report('yes'), report('yes')], now).tier
		).toBe('platinum');
		expect(
			scoreCompatibility(
				[report('yes'), report('yes'), report('yes'), report('yes'), report('no')],
				now
			).tier
		).toBe('gold');
		expect(
			scoreCompatibility(
				[report('yes'), report('yes'), report('yes'), report('no'), report('no')],
				now
			).tier
		).toBe('silver');
		expect(
			scoreCompatibility(
				[report('yes'), report('yes'), report('no'), report('no'), report('no')],
				now
			).tier
		).toBe('bronze');
		expect(scoreCompatibility([report('no'), report('no'), report('no')], now).tier).toBe('borked');
	});

	it('uses the 365-day half-life and clamps future reports to full weight', () => {
		expect(recencyWeight(new Date('2025-01-01T00:00:00.000Z'), now)).toBeCloseTo(0.5, 2);
		expect(recencyWeight(new Date('2027-01-01T00:00:00.000Z'), now)).toBe(1);
	});
});
