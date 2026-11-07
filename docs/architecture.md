# TuxGG architecture

## Runtime

- SvelteKit 3, Svelte 5, Tailwind CSS 4, and the Node adapter.
- PostgreSQL with Drizzle ORM and a clean baseline migration.
- Better Auth with Steam OpenID sign-in.
- Steam AppID as the stable identity for every catalog game.

## Routes

- `/` and `/games`: Steam game catalog overview, title/AppID search, sorting, and pagination.
- `/games/[appId]/[slug]`: Steam metadata and TuxGG's published player reports.
- `/games/[appId]/[slug]/report/new`, `/my-reports`, and `/users/[username]`: account and contribution pages.
- `/settings` and `/settings/devices`: profile and private Linux/Steam Deck device records.
- `/about`, `/methodology`, `/data-sources`, `/privacy`, `/terms`, `/community-rules`, and `/contact`: service and data documentation.
- `/robots.txt`, `/sitemap.xml`, game sitemap chunks, and `/healthz`: crawling and operations.

## PostgreSQL model

- `games`: Steam AppID primary key, nullable title, slug, artwork URLs, complete JSONB metadata, generated search vector, and timestamps.
- `user`, `session`, `account`, and `verification`: Better Auth records.
- `user_devices`: private saved Linux PC and Steam Deck hardware.
- `native_reports`: user-authored reports linked to a game and an author, with pending/published moderation state and optional device snapshot.

Native reports retain foreign keys to `games` and `user`. The web role can read games and reports, insert only approved native report columns, manage user devices and Better Auth records, and cannot moderate or delete native reports. `tuxgg_importer` can upsert games only and has no authentication-table access. `tuxgg_migrator` owns schema objects and runs migrations.

## Catalog flow

`pnpm db:backup:games` exports the complete existing games table to a PostgreSQL archive and CSV outside the repository. It verifies the CSV, AppIDs, archive readability, and restore in a disposable database before reporting success. `pnpm db:restore:games -- <csv>` restores rows with AppID-based upserts and recursive metadata merging.

`pnpm steam:sync` refreshes a maximum of 20 catalog entries per run, one request at a time, with at least two seconds between requests. It can preview without database writes. `pnpm steam:discover` uses Steamworks `IStoreService/GetAppList` pages to find additional game AppIDs and names; it skips existing rows and does not request detailed metadata for every discovered game.

## Security and reports

- Better Auth secrets, database credentials, and the optional Steam Web API key stay server-side.
- Steam OpenID account identity is stored as `account.providerId = 'steam'` and `account.accountId`; no Steam tokens are stored.
- Report author IDs come from the authenticated session. New reports default to `pending`; only an operator can publish them.
- Saved-device hardware is derived server-side from validated Steam System Information. Every new report stores a hardware snapshot.
- User report text is rendered as escaped text.
- Search uses PostgreSQL full-text search and `pg_trgm`; app IDs and canonical slugs provide stable game URLs.

CI creates a clean PostgreSQL schema, runs the baseline, verifies runtime grants, and runs unit, auth, native report, device, browser, and build checks.
