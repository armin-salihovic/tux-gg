import { createHash } from 'node:crypto';

export const ACCOUNT_LINKING_OPTIONS = {
	enabled: true,
	disableImplicitLinking: true,
	trustedProviders: ['discord']
};

export interface DiscordProfile {
	id: string | number;
	avatar?: string | null;
	email?: string | null;
	verified?: boolean;
	global_name?: string | null;
	username?: string | null;
}

export function mapDiscordProfile(profile: DiscordProfile) {
	const id = String(profile.id);
	const image = profile.avatar
		? `https://cdn.discordapp.com/avatars/${id}/${profile.avatar}.png`
		: undefined;
	return {
		email: profile.email ?? `${id}@discord.placeholder.local`,
		emailVerified: profile.verified === true,
		name: profile.global_name || profile.username || `Player ${id.slice(-6)}`,
		username: `player-${createHash('sha256').update(id).digest('hex').slice(0, 10)}`,
		...(image ? { image } : {})
	};
}
