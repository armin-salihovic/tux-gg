import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

const databaseUrl = process.env.MIGRATION_DATABASE_URL;
if (!databaseUrl) {
	throw new Error(
		'Set MIGRATION_DATABASE_URL to the dedicated VapourDB migration connection before running Drizzle Kit.'
	);
}

export default defineConfig({
	dialect: 'postgresql',
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dbCredentials: { url: databaseUrl },
	strict: true,
	verbose: true
});
