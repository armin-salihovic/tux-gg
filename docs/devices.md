# Saved devices

Steam-authenticated users can save up to ten Linux PCs and Steam Decks in **Settings → Devices**. Windows, macOS, and systems whose operating system cannot be confirmed are rejected. VapourDB does not attest that pasted text is authentic; it strictly parses Steam System Information and derives the stored hardware from the submitted text on the server.

## Add or refresh a device

Open Steam's **Help → System Information**, copy the complete output, enter a friendly device name, and paste the text or upload a `.txt` file. **Detect System Information** uses the same parser as the server and shows the detected hardware as read-only information. Save submits the source text to the server for a second validation. The name is the only editable device value. Users may rename a device without changing its hardware, or replace the hardware snapshot by importing a new valid Steam System Information dump. A refresh replaces all stored hardware fields; it does not merge missing values from an older import.

The parser requires Steam section structure, an identified Linux/SteamOS environment, and CPU and GPU identification. Linux is accepted through explicit Linux kernel information or credible Linux distribution names; the distribution list is not a platform whitelist. Steam Deck classification requires SteamOS, Valve manufacturer information, and a Deck model or APU indicator, including LCD and OLED models. Generic SteamOS PCs stay classified as Linux desktops. Hardware values are never accepted from separate client form fields.

The original text is sent to VapourDB's server for validation; production connections use HTTPS. It is processed transiently and is not stored in the database, application logs, or analytics. VapourDB stores the device name and parsed specifications. Device records remain private to their owner. This parsing is not cryptographic hardware verification.

Existing devices created before server validation are retained and shown with **Reimport required**. They cannot be selected for new reports until the user imports supported Steam System Information. The device name can be kept or changed during reimport. No provenance is fabricated for existing records, and no device is deleted automatically.

Users can set one default device or delete a device. Only validated Linux PCs and Steam Decks appear in the report form. A user's default device is preselected when eligible; otherwise the first eligible device is selected. Each new report copies the device name and hardware into an immutable report snapshot. Renaming, refreshing, or deleting a device does not rewrite prior reports; deleting a device clears only its optional reference.

## Database schema and permissions

The baseline schema contains `user_devices` and the optional `device_id` and `device_name_snapshot` references on `native_reports`. `source_verified_at` distinguishes devices created from validated Steam System Information from older records. Existing devices without this value remain visible but require reimport before they can be used for a new report.

The web application, migrations, and database tools use the same configured PostgreSQL login. Account-scoped application queries enforce device ownership, and column-limited inserts protect moderation and publication fields on `native_reports`. Requests never run migrations or grants. See [database.md](database.md) for database setup.

## Tests

Unit and browser checks cover strict parser cases, Windows rejection, reimport provenance, ownership, mandatory report devices, immutable snapshots, and moderation restrictions. PostgreSQL integration tests require the explicitly marked `vapourdb_test` database, and test fixtures never run against the normal development database.
