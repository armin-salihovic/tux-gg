import { describe, expect, it } from 'vitest';
import {
	isValidUsername,
	USERNAME_MAX_LENGTH,
	USERNAME_MIN_LENGTH,
	usernameSchema
} from './usernames.js';

describe('username rules', () => {
	it.each([24, 25, 32])('accepts a %i-character public username', (length) => {
		const username = `a${'b'.repeat(length - 1)}`;
		expect(isValidUsername(username)).toBe(true);
		expect(usernameSchema.safeParse(username).success).toBe(true);
	});

	it('enforces the shared 3–32 character lowercase ASCII rule', () => {
		expect(USERNAME_MIN_LENGTH).toBe(3);
		expect(USERNAME_MAX_LENGTH).toBe(32);
		for (const username of [`a${'b'.repeat(32)}`, 'ab', '_abc', '-abc', 'a.b', 'äbc']) {
			expect(isValidUsername(username)).toBe(false);
			expect(usernameSchema.safeParse(username).success).toBe(false);
		}
	});

	it('retains settings normalization to lowercase and trimmed values', () => {
		expect(usernameSchema.parse('  Valid_Name-2  ')).toBe('valid_name-2');
		expect(isValidUsername('Abc')).toBe(false);
	});
});
