import { describe, expect, it } from 'vitest';
import { isIndexableGame, MIN_INDEXABLE_REPORTS } from './seo-constants.js';

describe('game indexability', () => {
	it('requires enough reports and a usable title', () => {
		expect(isIndexableGame(MIN_INDEXABLE_REPORTS, 'Team Fortress 2')).toBe(true);
		expect(isIndexableGame(MIN_INDEXABLE_REPORTS - 1, 'Team Fortress 2')).toBe(false);
		expect(isIndexableGame(MIN_INDEXABLE_REPORTS, '  ')).toBe(false);
		expect(isIndexableGame(MIN_INDEXABLE_REPORTS, null)).toBe(false);
	});
});
