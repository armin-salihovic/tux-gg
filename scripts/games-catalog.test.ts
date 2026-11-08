import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { parseGamesCsv } from './games-catalog.mjs';

describe('historical games CSV parsing', () => {
	it('preserves Unicode, quoted multiline fields, NULLs, nested metadata, and timestamps', () => {
		const games = parseGamesCsv(path.resolve('tests/fixtures/legacy-games.csv'));
		expect(games).toHaveLength(2);
		expect(games[0]).toMatchObject({
			app_id: '440',
			title: 'Café "Quoted", 東京\nSecond line',
			artwork_url: 'https://cdn.example.invalid/440.jpg',
			header_image_url: null,
			created_at: '2020-01-02T03:04:05.000Z',
			updated_at: '2024-06-07T08:09:10.000Z'
		});
		expect(JSON.parse(games[0].metadata)).toEqual({
			steam: { note: 'line one\nline two', nested: { kept: true } }
		});
		expect(games[1]?.title).toBeNull();
		expect(JSON.parse(games[1].metadata)).toEqual({ custom: [null, 'café'] });
	});

	it('rejects duplicate AppIDs and a missing CSV', () => {
		const csv =
			'app_id,title,slug,artwork_url,header_image_url,metadata,created_at,updated_at\n' +
			'440,Game,game,\\N,\\N,{},2020-01-02T03:04:05Z,2024-06-07T08:09:10Z\n' +
			'440,Game,game,\\N,\\N,{},2020-01-02T03:04:05Z,2024-06-07T08:09:10Z\n';
		const directory = mkdtempSync(path.join(tmpdir(), 'vapourdb-games-csv-'));
		const filePath = path.join(directory, 'duplicate.csv');
		try {
			writeFileSync(filePath, csv);
			expect(() => parseGamesCsv(filePath)).toThrow(/duplicate AppID/);
			expect(() => parseGamesCsv(path.join(directory, 'missing.csv'))).toThrow(/ENOENT/);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
