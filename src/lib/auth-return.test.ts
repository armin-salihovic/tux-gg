import { describe, expect, it } from 'vitest';
import { validateSameOriginReturnTo } from './auth-return.js';

describe('Steam login return destination', () => {
	const origin = 'https://tuxgg.example';

	it('preserves a valid app-relative path and query', () => {
		expect(
			validateSameOriginReturnTo('/games/440/team-fortress-2/report/new?draft=1', origin)
		).toBe('/games/440/team-fortress-2/report/new?draft=1');
	});

	it.each([
		'https://attacker.example/path',
		'//attacker.example/path',
		'/\\attacker.example/path',
		'/path#fragment',
		'javascript:alert(1)',
		'',
		'/'.padEnd(2049, 'a')
	])('rejects unsafe destination %s', (value) => {
		expect(validateSameOriginReturnTo(value, origin)).toBeNull();
	});
});
