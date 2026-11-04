import { sql } from 'drizzle-orm';
import {
	bigserial,
	boolean,
	char,
	check,
	customType,
	index,
	integer,
	jsonb,
	bigint,
	numeric,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';

const tsvector = customType<{ data: string }>({
	dataType() {
		return 'tsvector';
	}
});

export const games = pgTable(
	'games',
	{
		appId: text('app_id').primaryKey(),
		title: text('title'),
		slug: text('slug').notNull(),
		artworkUrl: text('artwork_url'),
		headerImageUrl: text('header_image_url'),
		metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
		searchVector: tsvector('search_vector')
			.generatedAlwaysAs(sql`setweight(to_tsvector('simple'::regconfig, coalesce(title, '')), 'A')`)
			.notNull(),
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
	},
	(table) => [
		index('games_search_vector_idx').using('gin', table.searchVector),
		index('games_title_trgm_idx').using('gin', sql`lower(${table.title}) gin_trgm_ops`),
		index('games_slug_idx').on(table.slug),
		index('games_updated_at_idx').on(table.updatedAt),
		check('games_app_id_check', sql`${table.appId} ~ '^[0-9]+$'`)
	]
);

export const importBatches = pgTable(
	'import_batches',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		sourceFilename: text('source_filename').notNull(),
		sourceChecksum: char('source_checksum', { length: 64 }).notNull(),
		sourceSchema: text('source_schema').notNull(),
		status: text('status').notNull(),
		startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
		finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
		sourceRecords: integer('source_records').notNull().default(0),
		insertedRecords: integer('inserted_records').notNull().default(0),
		duplicateRecords: integer('duplicate_records').notNull().default(0),
		chromebookRecords: integer('chromebook_records').notNull().default(0),
		invalidRecords: integer('invalid_records').notNull().default(0),
		missingFields: jsonb('missing_fields').$type<Record<string, number>>().notNull().default({}),
		errorSummary: text('error_summary')
	},
	(table) => [
		index('import_batches_started_idx').on(table.startedAt),
		index('import_batches_checksum_idx').on(table.sourceChecksum),
		check('import_batches_status_check', sql`${table.status} in ('running', 'complete', 'failed')`)
	]
);

export const reports = pgTable(
	'reports',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		appId: text('app_id')
			.notNull()
			.references(() => games.appId, { onDelete: 'cascade' }),
		source: text('source').notNull().default('protondb'),
		sourceFingerprint: char('source_fingerprint', { length: 64 }).notNull(),
		submittedAt: timestamp('submitted_at', { withTimezone: true, mode: 'date' }),
		sourceVerdict: text('source_verdict'),
		sourceRating: text('source_rating'),
		protonVersion: text('proton_version'),
		protonVariant: text('proton_variant'),
		customProtonVersion: text('custom_proton_version'),
		distribution: text('distribution'),
		kernel: text('kernel'),
		cpu: text('cpu'),
		gpu: text('gpu'),
		gpuVendor: text('gpu_vendor').notNull().default('Unknown'),
		graphicsDriver: text('graphics_driver'),
		ram: text('ram'),
		steamRuntimeVersion: text('steam_runtime_version'),
		xWindowManager: text('x_window_manager'),
		launchOptions: text('launch_options'),
		comments: text('comments'),
		hardwareDetails: text('hardware_details'),
		scoringValue: numeric('scoring_value', { precision: 5, scale: 4 }),
		sourceData: jsonb('source_data').$type<Record<string, unknown>>().notNull().default({}),
		importedBatchId: bigint('imported_batch_id', { mode: 'number' })
			.notNull()
			.references(() => importBatches.id, { onDelete: 'restrict' }),
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('reports_source_fingerprint_unique').on(table.sourceFingerprint),
		index('reports_app_date_idx').on(table.appId, table.submittedAt),
		index('reports_app_gpu_vendor_idx').on(table.appId, table.gpuVendor),
		index('reports_app_distribution_idx').on(table.appId, table.distribution),
		index('reports_app_proton_idx').on(table.appId, table.protonVariant, table.protonVersion),
		index('reports_app_verdict_idx').on(table.appId, table.sourceVerdict),
		index('reports_app_launch_options_idx').on(table.appId, table.launchOptions),
		index('reports_batch_idx').on(table.importedBatchId),
		check('reports_protondb_source_check', sql`${table.source} = 'protondb'`),
		check(
			'reports_scoring_value_range_check',
			sql`${table.scoringValue} is null or (${table.scoringValue} >= 0 and ${table.scoringValue} <= 1)`
		),
		check(
			'reports_gpu_vendor_check',
			sql`${table.gpuVendor} in ('NVIDIA', 'AMD', 'Intel', 'Apple', 'Multiple', 'Unknown')`
		)
	]
);

export const compatibilitySummaries = pgTable(
	'compatibility_summaries',
	{
		appId: text('app_id')
			.primaryKey()
			.references(() => games.appId, { onDelete: 'cascade' }),
		tier: text('tier').notNull().default('unknown'),
		reportCount: integer('report_count').notNull().default(0),
		scoredReportCount: integer('scored_report_count').notNull().default(0),
		yesCount: integer('yes_count').notNull().default(0),
		noCount: integer('no_count').notNull().default(0),
		weightedScore: numeric('weighted_score', { precision: 8, scale: 5 }),
		effectiveSampleSize: numeric('effective_sample_size', { precision: 12, scale: 4 }),
		verdictDistribution: jsonb('verdict_distribution')
			.$type<Record<string, number>>()
			.notNull()
			.default({}),
		lastReportAt: timestamp('last_report_at', { withTimezone: true, mode: 'date' }),
		calculatedAt: timestamp('calculated_at', { withTimezone: true, mode: 'date' })
			.notNull()
			.defaultNow()
	},
	(table) => [
		index('compatibility_summaries_tier_count_idx').on(table.tier, table.reportCount),
		index('compatibility_summaries_last_report_idx').on(table.lastReportAt),
		check(
			'compatibility_summaries_tier_check',
			sql`${table.tier} in ('platinum', 'gold', 'silver', 'bronze', 'borked', 'unknown')`
		)
	]
);

export const authUser = pgTable(
	'user',
	{
		id: text('id').primaryKey(),
		name: text('name').notNull(),
		email: text('email').notNull().unique(),
		emailVerified: boolean('email_verified').notNull().default(false),
		image: text('image'),
		username: text('username').notNull().unique(),
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
	},
	(table) => [check('user_username_check', sql`${table.username} ~ '^[a-z0-9][a-z0-9_-]{2,31}$'`)]
);

export const authSession = pgTable(
	'session',
	{
		id: text('id').primaryKey(),
		expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
		token: text('token').notNull().unique(),
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
		ipAddress: text('ip_address'),
		userAgent: text('user_agent'),
		userId: text('user_id')
			.notNull()
			.references(() => authUser.id, { onDelete: 'cascade' })
	},
	(table) => [index('session_user_id_idx').on(table.userId)]
);

export const authAccount = pgTable(
	'account',
	{
		id: text('id').primaryKey(),
		accountId: text('account_id').notNull(),
		providerId: text('provider_id').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => authUser.id, { onDelete: 'cascade' }),
		accessToken: text('access_token'),
		refreshToken: text('refresh_token'),
		idToken: text('id_token'),
		accessTokenExpiresAt: timestamp('access_token_expires_at', {
			withTimezone: true,
			mode: 'date'
		}),
		refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
			withTimezone: true,
			mode: 'date'
		}),
		scope: text('scope'),
		password: text('password'),
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('account_provider_account_unique').on(table.providerId, table.accountId),
		index('account_user_id_idx').on(table.userId)
	]
);

export const authVerification = pgTable(
	'verification',
	{
		id: text('id').primaryKey(),
		identifier: text('identifier').notNull(),
		value: text('value').notNull(),
		expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
	},
	(table) => [index('verification_identifier_idx').on(table.identifier)]
);

export const nativeReports = pgTable(
	'native_reports',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		appId: text('app_id')
			.notNull()
			.references(() => games.appId, { onDelete: 'cascade' }),
		authorId: text('author_id')
			.notNull()
			.references(() => authUser.id, { onDelete: 'cascade' }),
		verdict: text('verdict').notNull(),
		protonVersion: text('proton_version'),
		protonVariant: text('proton_variant'),
		customProtonVersion: text('custom_proton_version'),
		distribution: text('distribution'),
		kernel: text('kernel'),
		cpu: text('cpu'),
		gpu: text('gpu'),
		gpuVendor: text('gpu_vendor'),
		graphicsDriver: text('graphics_driver'),
		ram: text('ram'),
		launchOptions: text('launch_options'),
		performanceNotes: text('performance_notes'),
		knownIssues: text('known_issues'),
		content: text('content'),
		moderationState: text('moderation_state').notNull().default('pending'),
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
		publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' })
	},
	(table) => [
		index('native_reports_game_date_idx').on(table.appId, table.createdAt),
		index('native_reports_author_idx').on(table.authorId, table.createdAt),
		check('native_reports_verdict_check', sql`${table.verdict} in ('yes', 'no')`),
		check(
			'native_reports_moderation_check',
			sql`${table.moderationState} in ('pending', 'published', 'hidden', 'removed')`
		)
	]
);

export const schema = {
	games,
	importBatches,
	reports,
	compatibilitySummaries,
	authUser,
	authSession,
	authAccount,
	authVerification,
	nativeReports
};
