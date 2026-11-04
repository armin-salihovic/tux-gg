# ProtonDB source data analysis

Analysis performed against the files present in `protondb-data/` on 2026-11-04. The archive directory contains 96 `.tar.gz` exports (2,697,568,986 compressed bytes), dated from 2018 through 2026. Representative archives contain a single `reports_piiremoved.json` member encoded as one large JSON array, not JSON Lines. The importer streams that array from the compressed tar archive rather than extracting or loading it all into memory.

## Source files selected for the complete local corpus

These exports are dated snapshots. Adjacent 2026 exports demonstrate this: `reports_oct1_2026.tar.gz` has 395,467 rows and `reports_nov1_2026.tar.gz` has 400,906. All 395,283 distinct `(Steam app ID, timestamp)` keys from the October export occur in the November export with matching content; November adds 5,439 keys. Older snapshots repeat the same accumulated report corpus. Importing every monthly archive would therefore multiply rows without adding historical coverage.

The source README explicitly says to combine the last export before the October 2019 questionnaire change with the later exports. The selected local corpus is therefore:

| Archive                    |    Rows | Unique Steam app IDs | Date range in report timestamps                   | Role                                                              |
| -------------------------- | ------: | -------------------: | ------------------------------------------------- | ----------------------------------------------------------------- |
| `reports_oct1_2019.tar.gz` |  59,937 |                9,556 | 2018-08-21 to 2019-09-30 (one unusable timestamp) | Last available flat-schema export before the questionnaire change |
| `reports_nov1_2026.tar.gz` | 400,906 |               34,769 | 2019-10-28 to 2026-11-02                          | Newest available nested-schema snapshot                           |
| Combined                   | 460,843 |  36,892 distinct IDs | 2018-08-21 to 2026-11-02                          | Full local corpus before filtering and deduplication              |

The completed importer validation found 460,843 source records. It normalized 59,910 legacy and 400,514 nested reports; excluded 392 reports whose primary OS identifies ChromeOS/Chromebook; skipped 27 records without a usable Steam app ID; and removed 184 exact duplicate reports by canonical fingerprint. The resulting import set contains **460,240 reports for 36,884 games**. These are parser-level counts after the OS and app-ID rules, before and after deduplication as noted; they refine the raw source counts in the table above. The importer identified 27 unusable app IDs across the combined corpus; the earlier flat-record scan found 26 explicitly missing IDs, so malformed or otherwise unusable values are included in the normalized count.

The newest filename is dated November 1, but its latest report timestamp is November 2. The source data has no direct report identifier in either schema. The Steam app ID identifies a game, not a report.

## Schema eras and field mapping

### Flat questionnaire exports through October 2019

The flat records use top-level fields such as `appId`, `title`, `timestamp`, `rating`, `notes`, `os`, `gpuDriver`, `specs`, `cpu`, `gpu`, `kernel`, `ram`, `systemInfoNotes`, `duration`, `tweaks`, `protonVersion`, and `protonVersionManual`. Field presence varies by record. `specs` is a free-form hardware string and is not safely parseable into CPU and GPU fields. `timestamp` is usually epoch seconds but may be a string; one of the 59,937 selected records has an unusable pre-epoch timestamp. Twenty-six records have no Steam app ID and cannot be attached to a game.

Legacy `rating` values are already named categories, but they are not complete or consistently cased. In the selected archive the counts are: Borked 14,344; Platinum 25,515; Gold 9,239; Silver 7,525; Bronze 3,288 plus one lowercase `bronze`; one `Primary`; and 24 null/`None`. Normalize case for recognized categories and retain other values as unknown instead of guessing their meaning.

### Nested questionnaire exports from December 2019

Later reports use `app`, `responses`, `timestamp`, and `systemInfo`. `app.steam.appId` and `app.title` describe the game. `responses.verdict` is `yes` or `no`; it is not one of the Platinum-through-Borked categories. In the November 2026 export there are 325,027 `yes` and 75,879 `no` verdicts. `systemInfo` contains `cpu`, `gpu`, `gpuDriver`, `kernel`, `os`, and `ram`; later records also include `steamRuntimeVersion` and `xWindowManager`.

Useful response fields seen across the sampled exports include `protonVersion`, `variant`, `customProtonVersion`, `launchOptions`, `concludingNotes`, `notes`, `followUp`, `launcher`, `secondaryLauncher`, the fault/stability answers, and multiplayer/anti-cheat answers. Values can be missing, structured, or questionnaire-specific. Keep the original recognized response values in JSON for provenance while exposing normalized fields for search and display.

The February 2022 source README describes a questionnaire change effective February 18, with the new shape first visible in the March 2022 export. New reports then specify `variant` (`experimental`, `ge`, `native`, `notListed`, `official`, or `older`), use `protonVersion` for the `older` case, and can include `customProtonVersion`, `launchOptions`, `triedOob`, `tinkerOverride`, `verdictOob`, and `concludingNotes`. New submissions no longer provide `type` or `flow`; their continued presence in later snapshots comes from older reports and must not be treated as evidence that new reports use those fields. In the newest export, 297,675 reports have one of the variant values and 103,231 do not.

Steam Deck information is present and retained. The newest export includes `didChangeControlLayout` (50,717 records), `batteryPerformance` (50,713), `readability` (50,688), `secondaryLauncher` (50,688), `controlLayout` (9,370), `controlLayoutCustomization` (9,252), and `frameRate` (376). `SteamOS Holo` is also a frequent `systemInfo.os` value. Game reports now show a selected, allowlisted subset of these ProtonDB questionnaire responses (battery performance, readability, controller layout, and reported frame-rate bins) without creating a separate rating or claiming Valve verification.

### Normalized application fields

| Application field     | Source mapping                                                                              | Handling                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Game ID/title         | Flat `appId`/`title`; nested `app.steam.appId`/`app.title`                                  | Convert numeric or string IDs to text; preserve observed title; no fabricated metadata             |
| Submitted date        | `timestamp`                                                                                 | Interpret numeric epoch seconds; keep an invalid/missing date as unknown and preserve source value |
| Source verdict/rating | Nested `responses.verdict`; flat `rating`                                                   | Store separately; do not relabel source values as a TuxGG tier                                     |
| Proton                | Flat/nested `protonVersion`, `protonVersionManual`, nested `variant`, `customProtonVersion` | Preserve raw values; nullable when absent                                                          |
| Linux system          | Flat OS/hardware fields; nested `systemInfo`                                                | Normalize available fields; retain `specs` as unparsed text                                        |
| Notes/options         | `notes`, `systemInfoNotes`, `concludingNotes`, `followUp`, `launchOptions`, `tweaks`        | Treat as untrusted plain text/JSON; redact email-shaped strings; never render as HTML              |
| Other responses       | `responses` and flat report fields                                                          | Preserve source values in filtered JSON for provenance and future questionnaire analysis           |

The 2026 export encodes 30,859 app IDs as numbers and 370,047 as strings. Both are normalized to text before joining or hashing. There are four records with no usable OS value in that export and eight in the selected legacy export. Twenty-four legacy records have no `rating` value, and one has an unsupported `Primary` value.

## Chromebook exclusion rule

The rule is explicit and testable: exclude a report only when its primary OS field (`systemInfo.os` for nested records or `os` for flat records) identifies ChromeOS/Chrome OS/Chromebook. The 2026 snapshot has 392 such OS matches; the selected pre-change snapshot has none. A broader case-insensitive scan found Chromebook/Chrome OS references elsewhere in 436 modern report records. Those references are not a basis for discarding a report: records whose primary OS is Linux remain eligible, and no Chromebook-specific statistics or filters are derived from incidental text. Fields whose names are explicitly Chromebook/ChromeOS-specific are omitted from the retained source JSON. SteamOS and Steam Deck fields are retained.

## Deduplication and source identity

There is no report ID or author ID in the source record shapes. A uniqueness constraint on `(appId, timestamp)` would lose data: the newest export has 184 duplicate app/timestamp keys, including 17 keys whose records have different content; the legacy export has 101 such keys, including 83 with different content. In contrast, a raw canonical full-record SHA-256 scan found 167 exact duplicate rows in the newest export and 18 in the legacy export. After applying OS and app-ID eligibility rules, the importer found 184 duplicate rows among records eligible for import.

The importer uses a canonical content fingerprint as its source deduplication key, not a fabricated ProtonDB report ID and not app ID plus timestamp. It selects only the newest snapshot for each schema era, so repeated monthly snapshots are not re-imported. If a later export revises a report but provides no stable report ID, the importer cannot prove that the revised content is the same report; such a changed record is retained as separate content. The application displays imported records as ProtonDB source reports and never assigns them to TuxGG accounts.

## Chromebook, data quality, and privacy observations

- The old export has 26 records without a Steam app ID; the newest export has none. Records without an app ID are counted and skipped because they cannot be attached to a game.
- One legacy timestamp resolves to year 0118 and is stored as an unknown date rather than being used for recency scoring.
- Compatibility evidence differs by era: legacy reports have categorical ratings; nested reports mostly have binary `yes`/`no` verdicts. The importer retains the source values rather than pretending both schemas say the same thing.
- The source contains hardware and OS details, free-form comments, launch options, and troubleshooting text. It contains no report-author/account identifier in the inspected record shapes. A conservative email-shaped-string scan found six matches in the selected corpus; the importer redacts email-shaped strings from displayable text. This is not a guarantee that all personal information in user-supplied comments has been found.
- Report comments and launch options are untrusted plain text. Svelte's normal escaping is used; no imported content is rendered with raw HTML.

## Game metadata and enrichment

The exports include Steam app ID and title but no description, artwork, developer, publisher, release date, genres, or store URL. The app can construct a Steam store link from the app ID; it does not treat that as imported metadata. Steam artwork is now requested directly from `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/{appId}/` without a metadata API, proxy, local cache, or database migration. Detail heroes use `header.jpg`; cards try `capsule_616x353.jpg` and then the header. Header image responses were checked for Team Fortress 2 (440), Dota 2 (570), and Counter-Strike 2 (730); the capsule was checked for Dota 2 (570). Asset availability remains per-app, and browser load errors lead to the TuxGG placeholder. App IDs are validated as canonical unsigned 32-bit decimal values before URL construction.

### Artwork rights and attribution

The artwork remains hosted by Steam and is not copied into TuxGG. The [Steam Subscriber Agreement](https://store.steampowered.com/subscriber_agreement/) identifies Valve and its licensors as owners of Steam content and restricts copying, publishing, or distributing that content without prior written consent unless otherwise permitted by the agreement or applicable terms. It does not clearly grant TuxGG a general right to embed store artwork on a public third-party site. **Deployment decision: permission to reuse or hotlink Steam and publisher artwork has not been confirmed. Review with the relevant rights holders or obtain permission before enabling this feature on the public deployment.** The implementation does not claim that public CDN availability is a reuse license.

## TuxGG rating methodology

The visible TuxGG tier is a transparent, locally calculated heuristic, not a ProtonDB rating. Each recognized report contributes a compatibility value:

| Source signal                                     |                            Value |
| ------------------------------------------------- | -------------------------------: |
| Nested `verdict=yes` / `verdict=no`               |                      1.00 / 0.00 |
| Legacy Platinum / Gold / Silver / Bronze / Borked | 1.00 / 0.80 / 0.60 / 0.35 / 0.00 |

Each signal is weighted by recency with a 365-day half-life: `weight = 2^(-age_days / 365)`, with future-dated records treated as age zero. Reports with unknown dates or unrecognized signals do not affect the tier. The weighted score is `sum(weight × value) / sum(weight)`. TuxGG shows `Unknown` until both the sum of weights and the effective sample size `(sum(weight)^2 / sum(weight^2))` are at least 3.

Once that evidence threshold is met, the score maps to tiers as follows: Platinum at 0.95 or higher; Gold at 0.80–0.9499; Silver at 0.60–0.7999; Bronze at 0.30–0.5999; Borked below 0.30. The page also shows the source yes/no or legacy-rating distribution and the report count, so a tier is not presented without context. The method does not infer tier from Proton version, GPU, comments, or a single workaround answer. Summary rows are precomputed and refreshed by the importer, not recalculated on page requests.

## Attribution and licensing

The source README states that the ProtonDB reports database is distributed under ODbL 1.0 and individual contents under DbCL 1.0. TuxGG attributes imported reports to ProtonDB, links to the source, and identifies the dataset and derived compatibility summaries as data distinct from TuxGG application code. Public redistribution of the imported or adapted database must preserve attribution and satisfy the applicable ODbL share-alike terms; see the [ODbL 1.0 text](https://opendatacommons.org/licenses/odbl/1-0/) and [DbCL 1.0 text](https://opendatacommons.org/licenses/dbcl/1-0/). This documentation records an implementation plan, not a legal opinion.

## Known limitations

- The local corpus stops at the November 1, 2026 export; later ProtonDB reports are not present.
- There is a gap between the last selected legacy report on September 30 and the first report in the later export on October 28, 2019. No local archive fills that interval.
- The source provides no stable report IDs, no author identities, and only game titles for catalog metadata.
- Historical ratings and modern verdicts are different signals; the TuxGG tier is an explicitly defined heuristic over them, not an official ProtonDB score.
- Email redaction is a narrow safeguard, not complete privacy review of imported free text.
