import { defineEnvVars } from '@sveltejs/kit/env';

const optional = (value: string | undefined) => value;

export const variables = defineEnvVars({
	DB_CONNECTION: { schema: optional },
	DB_HOST: { schema: optional },
	DB_PORT: { schema: optional },
	DB_DATABASE: { schema: optional },
	DB_USERNAME: { schema: optional },
	DB_PASSWORD: { schema: optional },
	BETTER_AUTH_SECRET: { schema: optional },
	BETTER_AUTH_URL: { schema: optional },
	PUBLIC_SITE_URL: { schema: optional },
	STEAM_API_KEY: { schema: optional },
	PUBLIC_CONTACT_EMAIL: { schema: optional },
	NODE_ENV: { schema: optional },
	HOST: { schema: optional },
	PORT: { schema: optional },
	PROTOCOL_HEADER: { schema: optional },
	HOST_HEADER: { schema: optional }
});
