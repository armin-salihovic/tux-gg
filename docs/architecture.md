# TuxGG architecture

## Runtime

- SvelteKit 3 with Svelte 5 runes and the Node adapter.
- Tailwind CSS 4 through its Vite plugin.
- PostgreSQL with Drizzle ORM and a checked-in SQL migration.
- Better Auth Discord OAuth, initialized only when its required environment values are present.
- A separate Python streaming importer for the local ProtonDB tar archives.

## Routes

- `/` landing page and database status.
- `/games` URL-driven catalog search, compatibility filter, sorting, and pagination.
- `/games/[appId]/[slug]` canonical game details, per-report filters, source attribution, and compatibility summary.
- `/login`, `/settings`, and `/users/[username]` Discord-backed account and public profile pages.
- `/about`, `/methodology`, `/data-sources`, `/privacy`, `/terms`, `/community-rules`, and `/contact` explain the service and its data.
- `/robots.txt`, `/sitemap.xml`, static/game sitemap chunks, and `/healthz` support crawling and operations.

## PostgreSQL model

- `games`: Steam app ID, title, slug, metadata placeholders, and generated search vector.
- `reports`: imported ProtonDB entries with source fields, normalized hardware, source fingerprint, and provenance JSON.
- `import_batches`: snapshot checksums and counts for each import run.
- `compatibility_summaries`: precomputed TuxGG scores and source distributions.
- Better Auth tables: user, session, account, and verification.
- `native_reports`: future TuxGG contribution model, kept separate and not exposed for submission yet.

PostgreSQL has separate `tuxgg_web`, `tuxgg_importer`, and `tuxgg_migrator` roles. The web role reads catalog/import tables and manages Better Auth data, but cannot write imported ProtonDB reports or compatibility summaries. The importer can update games, imported reports, batches, and summaries without authentication-table access. The migration role owns TuxGG schema objects and applies schema changes; it is not used by either runtime process. `pnpm db:grant` applies grants to known TuxGG tables after each migration.

## Security boundaries

- OAuth client secrets, auth secret, and database URLs are server-only environment values.
- Discord email and OAuth account data do not appear in public profile query results.
- Discord login alone never grants permission to publish reports.
- User-generated/imported comments are rendered as escaped text.
- Public report publishing remains disabled until Steam ownership can be verified.
- Responses include `nosniff`, frame denial, referrer policy, permissions policy, and production HSTS headers.

## Search and SEO

PostgreSQL full-text search and `pg_trgm` support title searches and typo tolerance. Search/filter pages are noindexed and canonicalize to the catalog. Game pages use stable Steam app IDs, canonical slugs, Open Graph metadata, and `VideoGame` JSON-LD without claiming an AggregateRating. Low-evidence game pages stay out of the index until enough reports are available.

Game cards and detail heroes use `src/lib/steam-assets.ts` to derive Steam CDN image candidates from validated app IDs. Existing `games.artwork_url` and `games.header_image_url` values are used in the browser only when they are HTTPS URLs from an allowlisted Steam asset host and match the same app ID. Browser image errors advance once to an alternate Steam asset and then a styled TuxGG placeholder; intrinsic dimensions and aspect ratios reserve layout space. Artwork is not fetched during a server render. Since the database has no verified-availability field for Steam assets, game pages use the local TuxGG-branded `static/og-default.svg` for Open Graph and Twitter/X previews rather than publishing an unverified CDN URL.

CI provisions an ephemeral PostgreSQL service, prepares a separately named and marked `tuxgg_test` database, checks that database setup leaves maintenance and unrelated database ownership and ACLs unchanged, runs importer recovery tests and mocked Discord lifecycle tests, and seeds deterministic Steam app fixtures before Playwright. Importer tests verify both the database name and marker before truncating tables.
