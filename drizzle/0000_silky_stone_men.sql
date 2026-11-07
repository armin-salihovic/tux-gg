CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"username" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_username_unique" UNIQUE("username"),
	CONSTRAINT "user_username_check" CHECK ("user"."username" ~ '^[a-z0-9][a-z0-9_-]{2,31}$')
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "games" (
	"app_id" text PRIMARY KEY NOT NULL,
	"title" text,
	"slug" text NOT NULL,
	"artwork_url" text,
	"header_image_url" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple'::regconfig, coalesce(title, '')), 'A')) STORED NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "games_app_id_check" CHECK ("games"."app_id" ~ '^[0-9]+$')
);
--> statement-breakpoint
CREATE TABLE "native_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" text NOT NULL,
	"author_id" text NOT NULL,
	"verdict" text NOT NULL,
	"platform" text,
	"proton_version" text,
	"proton_variant" text,
	"custom_proton_version" text,
	"distribution" text,
	"kernel" text,
	"cpu" text,
	"gpu" text,
	"gpu_vendor" text,
	"graphics_driver" text,
	"gpu_driver_detail" text,
	"ram" text,
	"device_id" uuid,
	"device_name_snapshot" text,
	"launch_options" text,
	"performance_notes" text,
	"known_issues" text,
	"content" text,
	"moderation_state" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "native_reports_verdict_check" CHECK ("native_reports"."verdict" in ('yes', 'no')),
	CONSTRAINT "native_reports_platform_check" CHECK ("native_reports"."platform" is null or "native_reports"."platform" in ('steam_deck', 'linux_desktop')),
	CONSTRAINT "native_reports_moderation_check" CHECK ("native_reports"."moderation_state" in ('pending', 'published', 'hidden', 'removed'))
);
--> statement-breakpoint
CREATE TABLE "user_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"device_type" text NOT NULL,
	"cpu" text,
	"gpu" text,
	"gpu_vendor" text,
	"ram" text,
	"distribution" text,
	"kernel" text,
	"graphics_driver" text,
	"gpu_driver_detail" text,
	"source_verified_at" timestamp with time zone,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_devices_type_check" CHECK ("user_devices"."device_type" in ('linux_desktop', 'steam_deck')),
	CONSTRAINT "user_devices_gpu_vendor_check" CHECK ("user_devices"."gpu_vendor" is null or "user_devices"."gpu_vendor" in ('NVIDIA', 'AMD', 'Intel', 'Apple', 'Multiple', 'Unknown'))
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "native_reports" ADD CONSTRAINT "native_reports_app_id_games_app_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."games"("app_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "native_reports" ADD CONSTRAINT "native_reports_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "native_reports" ADD CONSTRAINT "native_reports_device_id_user_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."user_devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_devices" ADD CONSTRAINT "user_devices_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_account_unique" ON "account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "games_search_vector_idx" ON "games" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "games_title_trgm_idx" ON "games" USING gin (lower("title") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "games_slug_idx" ON "games" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "games_updated_at_idx" ON "games" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "native_reports_game_date_idx" ON "native_reports" USING btree ("app_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "native_reports_author_idx" ON "native_reports" USING btree ("author_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "user_devices_user_created_idx" ON "user_devices" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_devices_one_default_per_user_idx" ON "user_devices" USING btree ("user_id") WHERE "user_devices"."is_default";
