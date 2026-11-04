CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE games (
    app_id text PRIMARY KEY CHECK (app_id ~ '^[0-9]+$'),
    title text,
    slug text NOT NULL,
    artwork_url text,
    header_image_url text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('simple'::regconfig, coalesce(title, '')), 'A')
    ) STORED NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX games_search_vector_idx ON games USING gin (search_vector);
CREATE INDEX games_title_trgm_idx ON games USING gin (lower(title) gin_trgm_ops);
CREATE INDEX games_slug_idx ON games (slug);
CREATE INDEX games_updated_at_idx ON games (updated_at);

CREATE TABLE import_batches (
    id bigserial PRIMARY KEY,
    source_filename text NOT NULL,
    source_checksum char(64) NOT NULL,
    source_schema text NOT NULL,
    status text NOT NULL CHECK (status IN ('running', 'complete', 'failed')),
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    source_records integer NOT NULL DEFAULT 0,
    inserted_records integer NOT NULL DEFAULT 0,
    duplicate_records integer NOT NULL DEFAULT 0,
    chromebook_records integer NOT NULL DEFAULT 0,
    invalid_records integer NOT NULL DEFAULT 0,
    missing_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
    error_summary text
);
CREATE INDEX import_batches_started_idx ON import_batches (started_at DESC);
CREATE INDEX import_batches_checksum_idx ON import_batches (source_checksum);

CREATE TABLE reports (
    id bigserial PRIMARY KEY,
    app_id text NOT NULL REFERENCES games (app_id) ON DELETE CASCADE,
    source text NOT NULL DEFAULT 'protondb' CHECK (source = 'protondb'),
    source_fingerprint char(64) NOT NULL UNIQUE,
    submitted_at timestamptz,
    source_verdict text,
    source_rating text,
    proton_version text,
    proton_variant text,
    custom_proton_version text,
    distribution text,
    kernel text,
    cpu text,
    gpu text,
    gpu_vendor text NOT NULL DEFAULT 'Unknown'
        CHECK (gpu_vendor IN ('NVIDIA', 'AMD', 'Intel', 'Apple', 'Multiple', 'Unknown')),
    graphics_driver text,
    ram text,
    steam_runtime_version text,
    x_window_manager text,
    launch_options text,
    comments text,
    hardware_details text,
    scoring_value numeric(5, 4) CHECK (scoring_value IS NULL OR scoring_value BETWEEN 0 AND 1),
    source_data jsonb NOT NULL DEFAULT '{}'::jsonb,
    imported_batch_id bigint NOT NULL REFERENCES import_batches (id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reports_app_date_idx ON reports (app_id, submitted_at DESC);
CREATE INDEX reports_app_gpu_vendor_idx ON reports (app_id, gpu_vendor);
CREATE INDEX reports_app_distribution_idx ON reports (app_id, distribution);
CREATE INDEX reports_app_proton_idx ON reports (app_id, proton_variant, proton_version);
CREATE INDEX reports_app_verdict_idx ON reports (app_id, source_verdict);
CREATE INDEX reports_app_launch_options_idx ON reports (app_id, launch_options);
CREATE INDEX reports_batch_idx ON reports (imported_batch_id);

CREATE TABLE compatibility_summaries (
    app_id text PRIMARY KEY REFERENCES games (app_id) ON DELETE CASCADE,
    tier text NOT NULL DEFAULT 'unknown'
        CHECK (tier IN ('platinum', 'gold', 'silver', 'bronze', 'borked', 'unknown')),
    report_count integer NOT NULL DEFAULT 0,
    scored_report_count integer NOT NULL DEFAULT 0,
    yes_count integer NOT NULL DEFAULT 0,
    no_count integer NOT NULL DEFAULT 0,
    weighted_score numeric(8, 5),
    effective_sample_size numeric(12, 4),
    verdict_distribution jsonb NOT NULL DEFAULT '{}'::jsonb,
    last_report_at timestamptz,
    calculated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX compatibility_summaries_tier_count_idx ON compatibility_summaries (tier, report_count DESC);
CREATE INDEX compatibility_summaries_last_report_idx ON compatibility_summaries (last_report_at DESC);

CREATE TABLE "user" (
    id text PRIMARY KEY,
    name text NOT NULL,
    email text NOT NULL UNIQUE,
    email_verified boolean NOT NULL DEFAULT false,
    image text,
    username text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9][a-z0-9_-]{2,31}$'),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "session" (
    id text PRIMARY KEY,
    expires_at timestamptz NOT NULL,
    token text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    ip_address text,
    user_agent text,
    user_id text NOT NULL REFERENCES "user" (id) ON DELETE CASCADE
);
CREATE INDEX session_user_id_idx ON "session" (user_id);

CREATE TABLE "account" (
    id text PRIMARY KEY,
    account_id text NOT NULL,
    provider_id text NOT NULL,
    user_id text NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
    access_token text,
    refresh_token text,
    id_token text,
    access_token_expires_at timestamptz,
    refresh_token_expires_at timestamptz,
    scope text,
    password text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT account_provider_account_unique UNIQUE (provider_id, account_id)
);
CREATE INDEX account_user_id_idx ON "account" (user_id);

CREATE TABLE verification (
    id text PRIMARY KEY,
    identifier text NOT NULL,
    value text NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_identifier_idx ON verification (identifier);

CREATE TABLE native_reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id text NOT NULL REFERENCES games (app_id) ON DELETE CASCADE,
    author_id text NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
    verdict text NOT NULL CHECK (verdict IN ('yes', 'no')),
    proton_version text,
    proton_variant text,
    custom_proton_version text,
    distribution text,
    kernel text,
    cpu text,
    gpu text,
    gpu_vendor text,
    graphics_driver text,
    ram text,
    launch_options text,
    performance_notes text,
    known_issues text,
    content text,
    moderation_state text NOT NULL DEFAULT 'pending'
        CHECK (moderation_state IN ('pending', 'published', 'hidden', 'removed')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz
);
CREATE INDEX native_reports_game_date_idx ON native_reports (app_id, created_at DESC);
CREATE INDEX native_reports_author_idx ON native_reports (author_id, created_at DESC);
