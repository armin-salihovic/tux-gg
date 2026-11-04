import {
	BETTER_AUTH_SECRET,
	BETTER_AUTH_URL,
	DATABASE_URL,
	DISCORD_CLIENT_ID,
	DISCORD_CLIENT_SECRET,
	NODE_ENV
} from '$app/env/private';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { authAccount, authSession, authUser, authVerification } from '#lib/server/db/schema.js';
import { getDb } from '#lib/server/db/db.js';
import { ACCOUNT_LINKING_OPTIONS, mapDiscordProfile } from '#lib/server/auth-profile.js';

export function isAuthConfigured(): boolean {
	return Boolean(
		DATABASE_URL &&
		BETTER_AUTH_SECRET &&
		BETTER_AUTH_URL &&
		DISCORD_CLIENT_ID &&
		DISCORD_CLIENT_SECRET
	);
}

function createAuth() {
	return betterAuth({
		appName: 'TuxGG',
		baseURL: BETTER_AUTH_URL!,
		secret: BETTER_AUTH_SECRET!,
		database: drizzleAdapter(getDb(), {
			provider: 'pg',
			schema: {
				user: authUser,
				session: authSession,
				account: authAccount,
				verification: authVerification
			}
		}),
		user: {
			additionalFields: {
				username: { type: 'string', required: true, input: true, returned: true }
			}
		},
		account: {
			accountLinking: ACCOUNT_LINKING_OPTIONS
		},
		socialProviders: {
			discord: {
				clientId: DISCORD_CLIENT_ID!,
				clientSecret: DISCORD_CLIENT_SECRET!,
				scope: ['identify', 'email'],
				mapProfileToUser: mapDiscordProfile
			}
		},
		session: {
			expiresIn: 60 * 60 * 24 * 30,
			updateAge: 60 * 60 * 24
		},
		advanced: {
			useSecureCookies: NODE_ENV === 'production',
			cookiePrefix: 'tuxgg'
		}
	});
}

type AuthInstance = ReturnType<typeof createAuth>;
let instance: AuthInstance | undefined;

export function getAuth(): AuthInstance {
	if (!isAuthConfigured()) {
		throw new Error(
			'Discord sign-in is not configured. Set the Better Auth and Discord environment variables.'
		);
	}
	return (instance ??= createAuth());
}
