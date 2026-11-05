import {
	BETTER_AUTH_SECRET,
	BETTER_AUTH_URL,
	DATABASE_URL,
	STEAM_API_KEY,
	NODE_ENV
} from '$app/env/private';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { authAccount, authSession, authUser, authVerification } from '#lib/server/db/schema.js';
import { getDb } from '#lib/server/db/db.js';
import { steamOpenID } from '#lib/server/steam-auth.js';

export function isAuthConfigured(): boolean {
	return Boolean(DATABASE_URL && BETTER_AUTH_SECRET && BETTER_AUTH_URL);
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
			accountLinking: { enabled: true, disableImplicitLinking: true }
		},
		plugins: [steamOpenID(STEAM_API_KEY)],
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
			'Sign-in is not configured. Set DATABASE_URL, BETTER_AUTH_URL, and BETTER_AUTH_SECRET.'
		);
	}
	return (instance ??= createAuth());
}
