import os from 'node:os';
import path from 'node:path';

export function resolveBackupDirectory(env = process.env, home = os.homedir()) {
	const configured = env.VAPOURDB_BACKUP_DIR || env.TUXGG_BACKUP_DIR;
	return path.resolve(configured || path.join(home, '.vapourdb-backups'));
}
