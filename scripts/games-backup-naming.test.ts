import { describe, expect, it } from 'vitest';
import { backupNaming } from './games-backup-naming.mjs';

describe('self-consistent games backup names', () => {
	it.each([
		['vapourdb', 'vapourdb-games-backup-v1', 'vapourdb-games-20261108.csv'],
		['vapourdb_test', 'vapourdb-games-backup-v1', 'vapourdb-games-20261108.csv'],
		['tuxgg', 'tuxgg-games-backup-v1', 'tuxgg-games-20261108.csv'],
		['tuxgg_test', 'tuxgg-games-backup-v1', 'tuxgg-games-20261108.csv']
	])('maps %s to a matching manifest and filename', (database, format, csv) => {
		const backup = backupNaming(database, '20261108');
		expect(backup.format).toBe(format);
		expect(backup.csv).toBe(csv);
		expect(backup.archive.replace(/\.dump$/, '.csv')).toBe(backup.csv);
		expect(backup.manifest.replace(/\.manifest\.json$/, '.csv')).toBe(backup.csv);
	});

	it('rejects unknown database identities', () => {
		expect(() => backupNaming('unrelated', '20261108')).toThrow(/not recognized/);
	});
});
