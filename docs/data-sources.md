# Catalog data sources

The existing `public.games` table is the starting catalog. Its full contents are backed up before schema cleanup. The export includes every original non-generated column: Steam AppID, title, slug, artwork URLs, complete JSONB metadata, and creation/update timestamps.

TuxGG can refresh metadata for selected existing games from Steam Store app details. The refresh script is capped at 20 AppIDs per run, defaults to 10, sends requests sequentially with a minimum two-second delay, and preserves non-empty fields and unrelated metadata. Use its dry-run mode to inspect Steam responses without updating the database.

Catalog discovery uses Steamworks `IStoreService/GetAppList`, which returns paged app IDs and names. Discovery skips IDs already in the TuxGG catalog and does not call app details for each discovered game. See [Steamworks IStoreService](https://partner.steamgames.com/doc/webapi/IStoreService?l=english).

Steam artwork URLs remain in the game's original `artwork_url` and `header_image_url` columns. New Steam fields are stored under `metadata.steam`; discovery provenance is stored under `metadata.steamCatalog`. Both update paths merge JSONB and retain unknown existing metadata keys.

TuxGG community reports are authored by signed-in players and stored separately in `native_reports`. They do not come from the Steam API.
