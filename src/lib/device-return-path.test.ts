import { describe, expect, it } from 'vitest';
import { safeDeviceReturnPath } from './device-return-path.js';

describe('safe device return path', () => {
	it('keeps game report paths on this site', () => {
		expect(safeDeviceReturnPath('/games/440/team-fortress-2/report/new')).toBe(
			'/games/440/team-fortress-2/report/new'
		);
	});

	it.each([
		'https://evil.invalid',
		'//evil.invalid/path',
		'/\\evil.invalid',
		'/settings',
		'/games/440/x/report/new?next=//evil.invalid'
	])('rejects unsafe or unexpected destinations: %s', (value) =>
		expect(safeDeviceReturnPath(value)).toBeNull()
	);
});
