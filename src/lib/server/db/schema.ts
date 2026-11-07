import { desc, sql } from 'drizzle-orm';
import {
	boolean,
	check,
	customType,
	index,
	jsonb,
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
		metadata: jsonb('metadata').$type<unknown>().notNull().default({}),
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

export const userDevices = pgTable(
	'user_devices',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id')
			.notNull()
			.references(() => authUser.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		deviceType: text('device_type').notNull(),
		cpu: text('cpu'),
		gpu: text('gpu'),
		gpuVendor: text('gpu_vendor'),
		ram: text('ram'),
		distribution: text('distribution'),
		kernel: text('kernel'),
		graphicsDriver: text('graphics_driver'),
		gpuDriverDetail: text('gpu_driver_detail'),
		sourceVerifiedAt: timestamp('source_verified_at', { withTimezone: true, mode: 'date' }),
		isDefault: boolean('is_default').notNull().default(false),
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
	},
	(table) => [
		index('user_devices_user_created_idx').on(table.userId, table.createdAt),
		uniqueIndex('user_devices_one_default_per_user_idx')
			.on(table.userId)
			.where(sql`${table.isDefault}`),
		check('user_devices_type_check', sql`${table.deviceType} in ('linux_desktop', 'steam_deck')`),
		check(
			'user_devices_gpu_vendor_check',
			sql`${table.gpuVendor} is null or ${table.gpuVendor} in ('NVIDIA', 'AMD', 'Intel', 'Apple', 'Multiple', 'Unknown')`
		)
	]
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
		platform: text('platform'),
		protonVersion: text('proton_version'),
		protonVariant: text('proton_variant'),
		customProtonVersion: text('custom_proton_version'),
		distribution: text('distribution'),
		kernel: text('kernel'),
		cpu: text('cpu'),
		gpu: text('gpu'),
		gpuVendor: text('gpu_vendor'),
		graphicsDriver: text('graphics_driver'),
		gpuDriverDetail: text('gpu_driver_detail'),
		ram: text('ram'),
		deviceId: uuid('device_id').references(() => userDevices.id, { onDelete: 'set null' }),
		deviceNameSnapshot: text('device_name_snapshot'),
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
		index('native_reports_game_date_idx').on(table.appId, desc(table.createdAt)),
		index('native_reports_author_idx').on(table.authorId, desc(table.createdAt)),
		check('native_reports_verdict_check', sql`${table.verdict} in ('yes', 'no')`),
		check(
			'native_reports_platform_check',
			sql`${table.platform} is null or ${table.platform} in ('steam_deck', 'linux_desktop')`
		),
		check(
			'native_reports_moderation_check',
			sql`${table.moderationState} in ('pending', 'published', 'hidden', 'removed')`
		)
	]
);

export const schema = {
	games,
	authUser,
	authSession,
	authAccount,
	authVerification,
	nativeReports,
	userDevices
};
