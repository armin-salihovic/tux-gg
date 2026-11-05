# TuxGG architecture

## Runtime

- SvelteKit 3 with Svelte 5 runes and the Node adapter.
- Tailwind CSS 4 through its Vite plugin.
- PostgreSQL with Drizzle ORM and a checked-in SQL migration.
- Better Auth sessions with a local Steam OpenID 2.0 plugin, initialized only when the database and Better Auth environment values are present.
- A separate Python streaming importer for the local ProtonDB tar archives.

## Routes

- `/` landing page and database status.
- `/games` URL-driven catalog search, compatibility filter, sorting, and pagination.
- `/games/[appId]/[slug]` canonical game details, per-report filters, source attribution, and compatibility summary.
- `/login`, `/settings`, `/my-reports`, `/games/[appId]/[slug]/report/new`, and `/users/[username]` Steam-backed account and contribution pages.
- `/about`, `/methodology`, `/data-sources`, `/privacy`, `/terms`, `/community-rules`, and `/contact` explain the service and its data.
- `/robots.txt`, `/sitemap.xml`, static/game sitemap chunks, and `/healthz` support crawling and operations.

## PostgreSQL model

- `games`: Steam app ID, title, slug, metadata placeholders, and generated search vector.
- `reports`: imported ProtonDB entries with source fields, normalized hardware, source fingerprint, and provenance JSON.
- `import_batches`: snapshot checksums and counts for each import run.
- `compatibility_summaries`: precomputed TuxGG scores and source distributions.
- Better Auth tables: user, session, account, and verification.
- `native_reports`: user-authored compatibility reports with their own platform, author, and moderation state. These are separate from imported ProtonDB reports.

PostgreSQL has separate `tuxgg_web`, `tuxgg_importer`, and `tuxgg_migrator` roles. The web role reads catalog/import tables and manages Better Auth data, but cannot write imported ProtonDB reports or compatibility summaries. It can insert native report content using column-level privileges that exclude moderation state and timestamps; the database default sets moderation to `pending`. It cannot update or delete native reports. The importer can update games, imported reports, batches, and summaries without authentication-table access. The migration role owns TuxGG schema objects and applies schema changes; it is not used by either runtime process. `pnpm db:grant` applies reviewed grants to known tables after each migration.

## Security boundaries

- Better Auth secret, database URL, and optional Steam Web API key are server-only environment values.
- SteamID64 is stored as `account.providerId = 'steam'` and `account.accountId`; no Steam tokens are stored.
- Steam placeholder email addresses are unverified, private, and never used for email or account merging.
- Steam-linked users can submit pending reports. Submission permission is separate from publication permission, which remains operator-only.
- User-generated/imported comments are rendered as escaped text.
- Native report actions take author IDs from the authenticated session, verify a Steam account link, rate limit submissions, and never accept moderation state from the browser.
- Responses include `nosniff`, frame denial, referrer policy, permissions policy, and production HSTS headers.

## Search and SEO

PostgreSQL full-text search and `pg_trgm` support title searches and typo tolerance. Search/filter pages are noindexed and canonicalize to the catalog. Game pages use stable Steam app IDs, canonical slugs, Open Graph metadata, and `VideoGame` JSON-LD without claiming an AggregateRating. Low-evidence game pages stay out of the index until enough reports are available.

Game cards and detail heroes use `src/lib/steam-assets.ts` to derive Steam CDN image candidates from validated app IDs. Existing `games.artwork_url` and `games.header_image_url` values are used in the browser only when they are HTTPS URLs from an allowlisted Steam asset host and match the same app ID. Browser image errors advance once to an alternate Steam asset and then a styled TuxGG placeholder; intrinsic dimensions and aspect ratios reserve layout space. Artwork is not fetched during a server render. Since the database has no verified-availability field for Steam assets, game pages use the local TuxGG-branded 1200 × 630 `static/og-default.png` for Open Graph and Twitter/X previews rather than publishing an unverified CDN URL.

The Steam callback uses Better Auth's single-use, browser-bound state handling; validates the exact realm and return URL; checks the SteamID64 and signed OpenID fields; verifies each assertion with Steam's `check_authentication` endpoint; and reserves the Steam response nonce against replay. Better Auth creates the account and session, while profile enrichment is optional and failure-tolerant. No schema migration is required.

CI provisions an ephemeral PostgreSQL service, prepares a separately named and marked `tuxgg_test` database, checks that database setup leaves maintenance and unrelated database ownership and ACLs unchanged, runs importer recovery tests and mocked Steam lifecycle tests, and seeds deterministic Steam app fixtures before Playwright. Importer tests verify both the database name and marker before truncating tables.

## Native report flow

- `/games/[appId]/[slug]/report/new` requires a Better Auth session backed by a Steam account and inserts only into `native_reports`.
- New rows default to `pending`; `/my-reports` filters by the session user ID and is not publicly cacheable.
- Game pages show only `published` native reports in the TuxGG Community Reports section. Imported ProtonDB reports retain their existing query, filters, counts, and scoring.
- `scripts/moderate_native_reports.py` is an operator-only CLI. It requires `NATIVE_REPORT_OPERATOR_DATABASE_URL`, which must never be configured in the web process. It can list pending reports and transition native rows to `published`, `hidden`, or `removed`.
