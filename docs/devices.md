# Saved devices

Steam-authenticated users can save up to ten Linux PCs and Steam Decks in **Settings → Devices**. Windows, macOS, and systems whose operating system cannot be confirmed are rejected. TuxGG does not attest that pasted text is authentic; it strictly parses Steam System Information and derives the stored hardware from the submitted text on the server.

## Add or refresh a device

Open Steam's **Help → System Information**, copy the complete output, enter a friendly device name, and paste the text or upload a `.txt` file. **Detect System Information** uses the same parser as the server and shows the detected hardware as read-only information. Save submits the source text to the server for a second validation. The name is the only editable device value. Users may rename a device without changing its hardware, or replace the hardware snapshot by importing a new valid Steam System Information dump. A refresh replaces all stored hardware fields; it does not merge missing values from an older import.

The parser requires Steam section structure, an identified Linux/SteamOS environment, and CPU and GPU identification. Linux is accepted through explicit Linux kernel information or credible Linux distribution names; the distribution list is not a platform whitelist. Steam Deck classification requires SteamOS, Valve manufacturer information, and a Deck model or APU indicator, including LCD and OLED models. Generic SteamOS PCs stay classified as Linux desktops. Hardware values are never accepted from separate client form fields.

The original text is sent to TuxGG's server for validation; production connections use HTTPS. It is processed transiently and is not stored in the database, application logs, or analytics. TuxGG stores the device name and parsed specifications. Device records remain private to their owner. This parsing is not cryptographic hardware verification.

Existing devices created before server validation are retained and shown with **Reimport required**. They cannot be selected for new reports until the user imports supported Steam System Information. The device name can be kept or changed during reimport. No provenance is fabricated for existing records, and no device is deleted automatically.

Users can set one default device or delete a device. Only validated Linux PCs and Steam Decks appear in the report form. A user's default device is preselected when eligible; otherwise the first eligible device is selected. Each new report copies the device name and hardware into an immutable report snapshot. Renaming, refreshing, or deleting a device does not rewrite prior reports; deleting a device clears only its optional reference.

## Database migration and permissions

Migration `0003_user_devices.sql` adds the device table and nullable report snapshot references. Migration `0004_user_device_source_verification.sql` adds a nullable provenance timestamp. Existing devices remain unverified until reimport. Both migrations are additive and leave imported ProtonDB data and historical native report snapshots untouched.

For every existing installation, use:

```powershell
pnpm db:upgrade
```

The command verifies the `tuxgg` database, the runtime, migration, and administration connections, the Drizzle migration ledger, and the current PostgreSQL installation. Before it makes schema or permission changes, it creates a custom-format `pg_dump` backup and verifies that `pg_restore` can list and extract the archive. It then applies pending reviewed migrations, refreshes only the configured runtime role's reviewed privileges, checks those privileges through `DATABASE_URL`, and confirms that existing application-table row counts remain unchanged. It never creates roles, changes passwords, truncates data, or calls `pnpm db:setup`.

The web role receives CRUD access to `user_devices`, read access to imported data, and column-limited inserts on `native_reports`. It cannot write imported ProtonDB reports or summaries, update native reports, or set moderation/publication fields. If the migration role lacks its schema ownership or create grants, the upgrade stops with a diagnostic rather than changing ownership or permissions to make migrations pass. See [database.md](database.md) for configuration, dry-run, backup, and recovery details.

The database upgrade is an operator/deployment step. The web application never runs migrations or grants on a user request.

## Tests

Unit and browser checks cover strict parser cases, Windows rejection, reimport provenance, ownership, mandatory report devices, immutable snapshots, and moderation restrictions. PostgreSQL upgrade integration tests use a separate database cloned from the explicitly marked `tuxgg_test`; they never run destructive setup against the normal `tuxgg` database.
