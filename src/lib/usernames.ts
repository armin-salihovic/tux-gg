import { z } from 'zod';

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;
export const USERNAME_PATTERN_SOURCE = '^[a-z0-9][a-z0-9_-]{2,31}$';
export const USERNAME_PATTERN = new RegExp(USERNAME_PATTERN_SOURCE);

const USERNAME_RULE_MESSAGE =
	'Use 3–32 lowercase letters, numbers, underscores, or hyphens, starting with a letter or number.';

export function isValidUsername(username: string): boolean {
	return USERNAME_PATTERN.test(username);
}

export const usernameSchema = z
	.string()
	.trim()
	.toLowerCase()
	.min(USERNAME_MIN_LENGTH, USERNAME_RULE_MESSAGE)
	.max(USERNAME_MAX_LENGTH, USERNAME_RULE_MESSAGE)
	.regex(USERNAME_PATTERN, USERNAME_RULE_MESSAGE);
