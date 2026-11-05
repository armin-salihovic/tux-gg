# MVP hardening implementation checklist

This checklist tracks the implementation request in the TuxGG workspace. “Implemented” means code/documentation is in place; it does not imply that unavailable external infrastructure has been verified.

## Stage 1 — Correctness and security

- [x] Force authenticated dynamic HTML to `private, no-store`; retain anonymous page and static asset caching policies.
- [x] Pass an explicit runtime environment allowlist to the Compose app; keep PostgreSQL administration and migration URLs host-side.
- [x] Bind the host-published app port to loopback and document host-proxy and container-proxy arrangements.
- [x] Load local `.env` for Python importer commands without replacing shell-provided values or printing connection secrets.
- [x] Commit the missing Drizzle initial snapshot and align initial schema index definitions.
- [x] Add incremental import batch metadata migration; keep the existing initial migration intact.
- [x] Apply the migration chain to a fresh disposable PostgreSQL database and rerun it against an already migrated, populated disposable database.

## Stage 2 — Steam artwork

- [x] Centralize validated Steam App ID URL construction and trusted existing artwork URL handling.
- [x] Add shared card/header artwork rendering, native lazy loading, reserved dimensions, bounded fallback attempts, and TuxGG placeholder.
- [x] Use artwork on cards, the homepage, and game detail heroes; use a branded Open Graph image until Steam artwork availability is verified.
- [x] Verify current Steam CDN URL responses for App IDs 440, 570, and 730; verify the Dota 2 capsule path.
- [x] Document that public third-party artwork reuse/hotlink rights are not confirmed and require a deployment decision.
- [ ] Measure Core Web Vitals on a deployed representative dataset.

## Stage 3 — Data reliability, SEO, and query work

- [x] Mark sample imports separately; keep incomplete imports out of summaries and report pages.
- [x] Resume failed imports from the start using fingerprints for deduplication; finalize report batch ownership only when a full import completes.
- [x] Make summary rebuilds use completed full imports or matching completed samples and delete summaries with no visible reports.
- [x] Centralize minimum report/title indexability and apply it to page robots metadata and sitemap queries.
- [x] Cache global homepage statistics for 60 seconds from the precomputed summary table.
- [x] Align SQL and TypeScript recency weighting to the same 365-day half-life.
- [x] Surface a bounded set of ProtonDB Steam Deck questionnaire fields with an explicit player-report caveat.
- [x] Run `EXPLAIN (ANALYZE, BUFFERS)` and compare the old homepage aggregate with precomputed stats on the imported corpus; record measurements in `docs/performance.md`.

## Stage 4 — Verification and deployment

- [x] Add importer unit and disposable-PostgreSQL recovery tests.
- [x] Add tests for Steam URL validation, artwork fallback progression, cache policy, indexability, scoring, and Steam Deck value mapping.
- [x] Add pull request CI for formatting, linting, type checks, unit tests, importer recovery tests, production build, and Playwright with PostgreSQL.
- [x] Use the pnpm version in `package.json`, keep migrations off the maintenance database, and use a disposable marked `tuxgg_test` database for destructive tests.
- [x] Verify database setup against a disposable three-database server and keep maintenance/unrelated database ownership and ACLs unchanged.
- [x] Seed deterministic Steam app fixtures for browser tests; verify image success, 404/network fallbacks, layout dimensions, lazy/eager loading, and branded social metadata.
- [x] Separate web, importer, and migration roles with table-specific grants and a `tuxgg_app` compatibility transition.
- [x] Document data licenses, Steam artwork limitations, missing operator/contact details, and public-launch requirements.
- [x] Cover first and returning Steam sign-in, mocked OpenID callbacks, internal account creation, sessions, expiry/logout, invalid and expired state, replay protection, profile fallback, duplicate Steam IDs, profile changes, secure cookie flags, protected routes, and publishing denial with isolated mocked-provider tests.
- [ ] Run one live Steam OpenID flow after the public HTTPS origin is configured.
- [x] Verify effective Compose environment and healthy production-container startup against a disposable PostgreSQL instance.

## External launch decisions

- [ ] Obtain or confirm rights to display Steam/publisher artwork on a public third-party site.
- [ ] Configure the public operator identity, jurisdiction, monitored contact address, HTTPS origin, Better Auth secret, and production secret storage.
- [ ] Review imported report redistribution and derived-database obligations under ODbL 1.0 and DbCL 1.0 with the deployment operator.
