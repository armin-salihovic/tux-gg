import { describe, expect, it } from 'vitest';
import { ACCOUNT_LINKING_OPTIONS, mapDiscordProfile } from './auth-profile.js';

describe('Discord authentication profile policy', () => {
	it('keeps Discord as the only trusted provider and blocks implicit linking', () => {
		expect(ACCOUNT_LINKING_OPTIONS).toEqual({
			enabled: true,
			disableImplicitLinking: true,
			trustedProviders: ['discord']
		});
	});

	it('handles a missing Discord email without exposing it in public profile fields', () => {
		const mapped = mapDiscordProfile({
			id: '123456789',
			username: 'deck-player',
			avatar: 'avatar-hash',
			verified: false
		});

		expect(mapped.email).toBe('123456789@discord.placeholder.local');
		expect(mapped.emailVerified).toBe(false);
		expect(mapped.name).toBe('deck-player');
		expect(mapped.username).toMatch(/^player-[a-f0-9]{10}$/);
		expect(mapped.image).toBe('https://cdn.discordapp.com/avatars/123456789/avatar-hash.png');
	});
});
