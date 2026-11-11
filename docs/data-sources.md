# Catalog data sources

The existing `public.games` table is the starting catalog. Its full contents are backed up before a local schema reset. The export includes every original non-generated column: Steam AppID, title, slug, artwork URLs, complete JSONB metadata, and creation/update timestamps. A separate PostgreSQL archive, CSV, and SHA-256 manifest are kept outside the repository.

VapourDB can refresh metadata for selected existing games from Steam Store app details. A successful response records `metadata.steam.lastFetchedAt`; entries remain fresh for 30 days. The refresh script selects at most 10 stale entries by default, caps a run at 20, sends requests sequentially at least two seconds apart, and preserves unrelated metadata. `--force` bypasses the cache. Dry-run mode previews stale and fresh entries using a database read only; it makes no Steam requests and performs no writes. Steam detail requests happen only in the explicit sync command, never during page rendering.

Catalog discovery uses Steamworks `IStoreService/GetAppList`, which returns paged app IDs and names. Discovery skips IDs already in the VapourDB catalog and does not call app details for each discovered game. See [Steamworks IStoreService](https://partner.steamgames.com/doc/webapi/IStoreService?l=english).

Steam artwork URLs remain in the game's original `artwork_url` and `header_image_url` columns. New Steam fields are stored under `metadata.steam`; discovery provenance is stored under `metadata.steamCatalog`. Both update paths merge JSONB and retain unknown existing metadata keys.

VapourDB community reports are authored by signed-in players and stored separately in `native_reports`. They do not come from the Steam API. Pending and published native yes/no reports appear publicly and contribute equally to compatibility tiers, weighted from `created_at` with a 365-day half-life. Hidden and removed reports are excluded; games need at least three total recency weight and an effective sample size of three before receiving a non-Unknown tier. Reports are public immediately and may be moderated afterward.
