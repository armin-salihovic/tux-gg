import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

describe('Steam sync command line', () => {
	it('loads the metadata helper and parses pnpm-forwarded options', () => {
		const result = spawnSync(
			process.execPath,
			['scripts/sync_steam_metadata.mjs', '--', '--invalid-option'],
			{ cwd: process.cwd(), encoding: 'utf8', timeout: 5000, windowsHide: true }
		);
		const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

		expect(result.status).toBe(1);
		expect(output).toContain('Unknown option: --invalid-option');
		expect(output).not.toContain('Cannot find module');
	});
});
