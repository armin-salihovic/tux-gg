import { describe, expect, it } from 'vitest';
import { recencyWeight, scoreSignal, tierForEvidence } from './scoring.js';

describe('TuxGG compatibility scoring', () => {
	it('maps recognized source signals without changing the source label', () => {
		expect(scoreSignal('yes', null)).toBe(1);
		expect(scoreSignal('no', null)).toBe(0);
		expect(scoreSignal(null, 'Gold')).toBe(0.8);
		expect(scoreSignal(null, 'Primary')).toBeNull();
	});

	it('requires the documented effective evidence before assigning a tier', () => {
		expect(tierForEvidence(1, 2.99, 5)).toBe('unknown');
		expect(tierForEvidence(1, 5, 2.99)).toBe('unknown');
		expect(tierForEvidence(0.95, 3, 3)).toBe('platinum');
		expect(tierForEvidence(0.8, 3, 3)).toBe('gold');
		expect(tierForEvidence(0.3, 3, 3)).toBe('bronze');
	});

	it('uses a 365-day half-life and clamps future reports to full weight', () => {
		const now = new Date('2026-01-01T00:00:00.000Z');
		expect(recencyWeight(new Date('2025-01-01T00:00:00.000Z'), now)).toBeCloseTo(0.5, 2);
		expect(recencyWeight(new Date('2027-01-01T00:00:00.000Z'), now)).toBe(1);
		expect(recencyWeight(null, now)).toBe(0);
	});
});
