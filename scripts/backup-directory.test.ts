import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { resolveBackupDirectory } from './backup-directory.mjs';

describe('backup directory naming compatibility', () => {
	it('uses VapourDB_BACKUP_DIR ahead of the deprecated TUXGG_BACKUP_DIR', () => {
		expect(
			resolveBackupDirectory(
				{ VAPOURDB_BACKUP_DIR: 'D:/new-backups', TUXGG_BACKUP_DIR: 'D:/legacy-backups' },
				'D:/home'
			)
		).toBe(path.resolve('D:/new-backups'));
	});

	it('accepts TUXGG_BACKUP_DIR as a fallback for existing setups', () => {
		expect(resolveBackupDirectory({ TUXGG_BACKUP_DIR: 'D:/legacy-backups' }, 'D:/home')).toBe(
			path.resolve('D:/legacy-backups')
		);
	});

	it('defaults new backups to the VapourDB directory', () => {
		expect(resolveBackupDirectory({}, 'D:/home')).toBe(path.resolve('D:/home/.vapourdb-backups'));
	});
});
