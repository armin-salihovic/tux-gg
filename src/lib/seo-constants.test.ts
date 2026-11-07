import { describe, expect, it } from 'vitest';
import { isIndexableGame, MIN_INDEXABLE_DESCRIPTION_LENGTH } from './seo-constants.js';

describe('game indexability', () => {
	const steamMetadata = {
		steam: { shortDescription: 'Team Fortress 2 is a class-based multiplayer game with many maps.' }
	};
	it('indexes complete Steam catalog pages without requiring community reports', () => {
		expect(isIndexableGame('Team Fortress 2', steamMetadata)).toBe(true);
	});

	it('keeps incomplete, untitled, or empty pages out of the index', () => {
		expect(isIndexableGame('Counter-Strike 2', {})).toBe(false);
		expect(isIndexableGame('Counter-Strike 2', { steam: { shortDescription: 'Short' } })).toBe(
			false
		);
		expect(isIndexableGame('  ', steamMetadata)).toBe(false);
		expect(isIndexableGame(null, steamMetadata)).toBe(false);
		expect(
			isIndexableGame('Counter-Strike 2', {
				steam: { shortDescription: 'x'.repeat(MIN_INDEXABLE_DESCRIPTION_LENGTH) }
			})
		).toBe(true);
	});
});
