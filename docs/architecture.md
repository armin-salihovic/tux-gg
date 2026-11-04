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

The runtime database role has only the table privileges needed by Better Auth, catalog reads, and importer writes. It cannot create schema objects. Run migrations with an administrator/migration credential and refresh grants afterward.

## Security boundaries

- OAuth client secrets, auth secret, and database URLs are server-only environment values.
- Discord email and OAuth account data do not appear in public profile query results.
- Discord login alone never grants permission to publish reports.
- User-generated/imported comments are rendered as escaped text.
- Public report publishing remains disabled until Steam ownership can be verified.
- Responses include `nosniff`, frame denial, referrer policy, permissions policy, and production HSTS headers.

## Search and SEO

PostgreSQL full-text search and `pg_trgm` support title searches and typo tolerance. Search/filter pages are noindexed and canonicalize to the catalog. Game pages use stable Steam app IDs, canonical slugs, Open Graph metadata, and `VideoGame` JSON-LD without claiming an AggregateRating. Low-evidence game pages stay out of the index until enough reports are available.

Game cards and detail heroes use `src/lib/steam-assets.ts` to derive Steam CDN image candidates from validated app IDs. Existing `games.artwork_url` and `games.header_image_url` values are used only when they are HTTPS URLs from an allowlisted Steam asset host and match the same app ID. Browser image errors advance to an alternate Steam asset and then a styled TuxGG placeholder. Artwork URLs are not persisted or fetched server-side; the existing columns remain available for explicitly supplied metadata. Open Graph images are emitted only for a trusted header URL already present in the database.
