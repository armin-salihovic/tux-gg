import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const GAME_COLUMNS = [
	'app_id',
	'title',
	'slug',
	'artwork_url',
	'header_image_url',
	'metadata',
	'created_at',
	'updated_at'
];

export function loadLocalEnv() {
	try {
		for (const line of readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
			const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
			if (!match || match[1] in process.env) continue;
			let value = match[2];
			if (
				(value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'"))
			) {
				value = value.slice(1, -1);
				if (match[2].startsWith('"'))
					value = value
						.replace(/\\n/g, '\n')
						.replace(/\\r/g, '\r')
						.replace(/\\"/g, '"')
						.replace(/\\\\/g, '\\');
			} else value = value.replace(/\s+#.*$/, '').trim();
			process.env[match[1]] = value;
		}
	} catch (error) {
		if (error.code !== 'ENOENT') throw error;
	}
}

export function parseGamesCsv(filePath) {
	const bytes = readFileSync(filePath);
	const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	const rows = [];
	let row = [];
	let value = '';
	let quoted = false;
	let inQuotes = false;
	let afterQuote = false;
	const pushField = () => {
		row.push({ value: !quoted && value === '\\N' ? null : value, quoted });
		value = '';
		quoted = false;
		afterQuote = false;
	};
	const pushRow = () => {
		pushField();
		rows.push(row);
		row = [];
	};
	for (let index = 0; index < source.length; index += 1) {
		const character = source[index];
		if (inQuotes) {
			if (character === '"') {
				if (source[index + 1] === '"') {
					value += '"';
					index += 1;
				} else {
					inQuotes = false;
					afterQuote = true;
				}
			} else value += character;
		} else if (character === '"') {
			if (value.length > 0 || quoted || afterQuote)
				throw new Error('CSV has an invalid quote placement.');
			quoted = true;
			inQuotes = true;
		} else if (character === ',') pushField();
		else if (character === '\n') pushRow();
		else if (character === '\r') {
			if (source[index + 1] === '\n') index += 1;
			pushRow();
		} else {
			if (afterQuote) throw new Error('CSV contains characters after a quoted field.');
			value += character;
		}
	}
	if (inQuotes) throw new Error('CSV ends inside a quoted field.');
	if (value.length || row.length || quoted) pushRow();
	if (rows.length === 0) throw new Error('CSV is empty.');
	const header = rows.shift().map((field) => field.value);
	if (
		header.length !== GAME_COLUMNS.length ||
		header.some((column, index) => column !== GAME_COLUMNS[index])
	)
		throw new Error(`CSV header must be: ${GAME_COLUMNS.join(',')}`);
	const ids = new Set();
	return rows.map((fields, index) => {
		if (fields.length !== GAME_COLUMNS.length)
			throw new Error(
				`CSV record ${index + 2} has ${fields.length} columns; expected ${GAME_COLUMNS.length}.`
			);
		const record = Object.fromEntries(
			GAME_COLUMNS.map((column, position) => [column, fields[position].value])
		);
		if (!record.app_id || !/^\d+$/.test(record.app_id))
			throw new Error(`CSV record ${index + 2} has an invalid AppID.`);
		if (ids.has(record.app_id)) throw new Error(`CSV contains duplicate AppID ${record.app_id}.`);
		ids.add(record.app_id);
		if (!record.slug) throw new Error(`CSV record ${index + 2} has no slug.`);
		if (record.metadata === null) throw new Error(`CSV record ${index + 2} has NULL metadata.`);
		try {
			JSON.parse(record.metadata);
		} catch {
			throw new Error(`CSV record ${index + 2} has invalid JSON metadata.`);
		}
		for (const column of ['created_at', 'updated_at']) {
			if (!record[column] || !Number.isFinite(Date.parse(record[column])))
				throw new Error(`CSV record ${index + 2} has an invalid ${column}.`);
		}
		return record;
	});
}

export function slugify(value, appId) {
	const slug = String(value ?? '')
		.normalize('NFKD')
		.toLowerCase()
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 100)
		.replace(/-$/g, '');
	return slug || `steam-app-${appId}`;
}

export const MERGE_METADATA_FUNCTION = `
CREATE OR REPLACE FUNCTION pg_temp.vapourdb_merge_metadata(existing jsonb, incoming jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
	result jsonb := COALESCE(existing, '{}'::jsonb);
	item record;
	previous jsonb;
	merged jsonb;
	existing_empty boolean;
	incoming_empty boolean;
BEGIN
	existing_empty := existing IS NULL OR existing = 'null'::jsonb
		OR existing = '{}'::jsonb OR existing = '[]'::jsonb OR existing = '""'::jsonb;
	incoming_empty := incoming IS NULL OR incoming = 'null'::jsonb
		OR incoming = '{}'::jsonb OR incoming = '[]'::jsonb OR incoming = '""'::jsonb;
	IF incoming_empty THEN RETURN CASE WHEN existing_empty THEN COALESCE(incoming, result) ELSE result END; END IF;
	IF jsonb_typeof(incoming) <> 'object' THEN RETURN incoming; END IF;
	IF existing_empty THEN result := '{}'::jsonb; END IF;
	IF jsonb_typeof(result) <> 'object' THEN RETURN result; END IF;
	FOR item IN SELECT key, value FROM jsonb_each(incoming) LOOP
		IF item.value = 'null'::jsonb
			OR (jsonb_typeof(item.value) = 'string' AND item.value #>> '{}' = '')
			OR (jsonb_typeof(item.value) = 'object' AND item.value = '{}'::jsonb)
			OR (jsonb_typeof(item.value) = 'array' AND item.value = '[]'::jsonb) THEN
			CONTINUE;
		END IF;
		previous := result -> item.key;
		IF jsonb_typeof(item.value) = 'object' THEN
			merged := pg_temp.vapourdb_merge_metadata(previous, item.value);
		ELSE
			merged := item.value;
		END IF;
		result := jsonb_set(result, ARRAY[item.key], merged, true);
	END LOOP;
	RETURN result;
END
$$`;
