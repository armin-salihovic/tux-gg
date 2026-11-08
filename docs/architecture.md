# VapourDB architecture

## Runtime

- SvelteKit 3, Svelte 5, Tailwind CSS 4, and the Node adapter.
- PostgreSQL with Drizzle ORM and a clean baseline migration.
- Better Auth with Steam OpenID sign-in.
- Steam AppID as the stable identity for every catalog game.

## Routes

- `/` and `/games`: Steam game catalog overview, title/AppID search, sorting, and pagination.
- `/games/[appId]/[slug]`: Steam metadata and VapourDB's published player reports.
- `/games/[appId]/[slug]/report/new`, `/my-reports`, and `/users/[username]`: account and contribution pages.
- `/settings` and `/settings/devices`: profile and private Linux/Steam Deck device records.
- `/about`, `/methodology`, `/data-sources`, `/privacy`, `/terms`, `/community-rules`, and `/contact`: service and data documentation.
- `/robots.txt`, `/sitemap.xml`, game sitemap chunks, and `/healthz`: crawling and operations.

## PostgreSQL model

- `games`: Steam AppID primary key, nullable title, slug, artwork URLs, complete JSONB metadata, generated search vector, and timestamps.
- `user`, `session`, `account`, and `verification`: Better Auth records.
- `user_devices`: private saved Linux PC and Steam Deck hardware.
- `native_reports`: user-authored reports linked to a game and an author, with pending/published moderation state and optional device snapshot.

Native reports retain foreign keys to `games` and `user`. One configured PostgreSQL account serves the application runtime and the database commands. Application code validates report submissions and moderation state; a production account should receive only the table and schema privileges required by runtime, migration, import, backup, and operator tasks. Local setup accepts PostgreSQL's `postgres` superuser when that is the chosen Docker development account. Legacy TuxGG database names remain recognized only in historical backup manifests; application commands target `vapourdb`.

## Catalog flow

`pnpm db:backup:games` exports the configured games table to a PostgreSQL archive and CSV outside the repository. It verifies CSV rows, AppIDs, checksums, and archive readability. When the configured account has `CREATEDB`, it also restores the archive in a uniquely named disposable database; otherwise it records the reduced verification level. `pnpm db:restore:games -- <csv>` restores rows with AppID-based upserts and recursive metadata merging.

`pnpm steam:sync` refreshes stale metadata for at most 10 games by default and 20 per run at most. Successful responses carry a 30-day `lastFetchedAt` cache timestamp. Requests are sequential, spaced at least two seconds apart, and use bounded retries. `--force` bypasses freshness checks. `--dry-run` reads the catalog to preview work and makes no Steam requests or database writes. `pnpm steam:discover` uses Steamworks `IStoreService/GetAppList` pages to find additional game AppIDs and names; it skips existing rows and does not request detailed metadata for every discovered game.

Public compatibility is calculated from published native yes/no reports. Each report's recency weight has a 365-day half-life. Pending, hidden, and removed reports are excluded, and the tier remains Unknown until total weight and effective sample size both reach three. Changes to moderation state are reflected on the next query. No compatibility summary table is materialized.

Game page indexability requires a non-empty title and a Steam short description of at least 50 characters. The sitemap query applies that same rule.

## Security and reports

- Better Auth secrets, database credentials, and the optional Steam Web API key stay server-side.
- Steam OpenID account identity is stored as `account.providerId = 'steam'` and `account.accountId`; no Steam tokens are stored.
- Report author IDs come from the authenticated session. New reports default to `pending`; only an operator can publish them.
- Saved-device hardware is derived server-side from validated Steam System Information. Every new report stores a hardware snapshot.
- User report text is rendered as escaped text.
- Search uses PostgreSQL full-text search and `pg_trgm`; app IDs and canonical slugs provide stable game URLs.

CI creates a clean PostgreSQL schema, runs the baseline, verifies runtime grants, and runs unit, auth, native report, device, browser, and build checks.
