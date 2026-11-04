import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

const databaseUrl =
	process.env.MIGRATION_DATABASE_URL || process.env.PGADMIN_URL || process.env.DATABASE_URL;
if (!databaseUrl) {
	throw new Error('Set MIGRATION_DATABASE_URL (or PGADMIN_URL) before running Drizzle Kit.');
}

export default defineConfig({
	dialect: 'postgresql',
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dbCredentials: { url: databaseUrl },
	strict: true,
	verbose: true
});
