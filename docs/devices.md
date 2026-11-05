# Saved devices

Steam-authenticated TuxGG users can keep up to ten computers and Steam Decks in **Settings → Devices**. Add a device by opening Steam's **Help → System Information**, copying the output, and pasting it into the device form. A UTF-8 `.txt` file can also be selected. **Detect System Information** parses the text in the browser; review the results and correct any field before saving. You may save partial hardware information when Steam omits a value.

TuxGG recognizes Steam's Linux System Information sections and common keys for CPU, video driver, driver version, memory, operating system, and kernel. It preserves unknown GPU names and identifies AMD, NVIDIA, and Intel vendors. Steam's RAM field can appear as `31188 Mb`; Steam uses this field for a megabyte count despite the capitalization, so TuxGG converts values of at least 1024 to a decimal GB value. Smaller `Mb` values remain unchanged because their meaning is ambiguous. Steam Deck detection requires SteamOS, Valve manufacturer information, and a Deck model/APU indicator.

The raw text and selected file are processed locally and are not sent to TuxGG. The application stores the user's device name/type and compatibility fields: CPU, GPU and vendor, RAM, operating system/distribution, kernel, graphics driver, and GPU driver detail. Motherboard, storage, monitor, serial, network, and other unrelated information is discarded. Device names and specifications are private to the owning account.

Devices can be renamed and corrected from **Settings → Devices → Edit**. Importing a refreshed System Information dump fills values it detects; when editing, a value absent from a new dump is left as it was, so missing information does not silently erase a saved value. Users can set one default device. The first saved device becomes the default, and deleting the default promotes the oldest remaining device.

When writing a report, select **Which device did you play on?** The saved device supplies the platform and hardware fields. The server rechecks ownership and reads the device record when it inserts the pending report. It ignores any client-supplied hardware fields. The report stores a hardware snapshot and device-name snapshot; later edits do not change it. Deleting a device nulls the optional device reference while retaining the report's name and hardware snapshot. Older reports continue to render without a device name.

## Database migration and permissions

Migration `0003_user_devices.sql` additively creates `user_devices` and adds a nullable device reference, device-name snapshot, and GPU driver detail to `native_reports`. The reference uses `ON DELETE SET NULL`; it does not touch imported ProtonDB reports, summaries, user accounts, or existing native report hardware.

For a local installation, first confirm that the existing `MIGRATION_DATABASE_URL` points to the intended `tuxgg` database, then run:

```sh
pnpm db:migrate
```

The web role needs `SELECT`, `INSERT`, `UPDATE`, and `DELETE` only on `user_devices`. Its `native_reports` insertion remains column-limited and excludes moderation state and timestamps. To refresh the role grants after reviewing the migration, confirm `PGADMIN_URL` points to the PostgreSQL maintenance database and run:

```sh
pnpm db:grant
```

`db:grant` refreshes grants for the `tuxgg` database only. Do not run destructive integration tests against `tuxgg`; use the marked `tuxgg_test` database.

## Tests

```sh
pnpm test:unit
```

The PostgreSQL integration and Playwright suites require `tuxgg_test`. Prepare and migrate that disposable database with the documented test setup in the README, then run `pnpm test:auth-integration` and `pnpm test:e2e` with the `tuxgg_web` and operator test URLs set to `tuxgg_test`.
