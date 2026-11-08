export function backupNaming(database, dateStamp) {
	const brand =
		database === 'tuxgg' || database === 'tuxgg_test'
			? 'tuxgg'
			: database === 'vapourdb' || database === 'vapourdb_test'
				? 'vapourdb'
				: null;
	if (!brand) throw new Error('Games backup database identity is not recognized.');
	const stem = `${brand}-games-${dateStamp}`;
	return {
		brand,
		format: `${brand}-games-backup-v1`,
		csv: `${stem}.csv`,
		archive: `${stem}.dump`,
		manifest: `${stem}.manifest.json`
	};
}
