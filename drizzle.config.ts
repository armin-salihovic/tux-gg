import { defineConfig } from 'drizzle-kit';
import { resolveDatabaseUrl, withMigrationTimeouts } from './scripts/database-connection.mjs';

const { raw } = resolveDatabaseUrl('migrate');

export default defineConfig({
	dialect: 'postgresql',
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dbCredentials: { url: withMigrationTimeouts(raw) },
	strict: true,
	verbose: true
});
