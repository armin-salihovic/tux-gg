import { defineEnvVars } from '@sveltejs/kit/env';

const optional = (value: string | undefined) => value;

export const variables = defineEnvVars({
	DATABASE_URL: { schema: optional },
	BETTER_AUTH_SECRET: { schema: optional },
	BETTER_AUTH_URL: { schema: optional },
	DISCORD_CLIENT_ID: { schema: optional },
	DISCORD_CLIENT_SECRET: { schema: optional },
	PUBLIC_SITE_URL: { schema: optional },
	PUBLIC_CONTACT_EMAIL: { schema: optional },
	NODE_ENV: { schema: optional },
	HOST: { schema: optional },
	PORT: { schema: optional },
	PROTOCOL_HEADER: { schema: optional },
	HOST_HEADER: { schema: optional }
});
