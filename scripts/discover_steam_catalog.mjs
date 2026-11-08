#!/usr/bin/env node

import { loadLocalEnv, slugify } from './games-catalog.mjs';
import { identityForDatabase, testIdentityForDatabase } from './database-identifiers.mjs';
import {
	createDatabaseClient,
	preflightDatabase,
	resolveDatabaseUrl
} from './database-connection.mjs';

loadLocalEnv();

function parseArgs(args) {
	let limit = 1000;
	let apply = false;
	for (let index = 0; index < args.length; index += 1) {
		if (args[index] === '--apply') apply = true;
		else if (args[index] === '--limit') {
			limit = Number(args[++index]);
			if (!Number.isInteger(limit) || limit < 1 || limit > 50_000)
				throw new Error('--limit must be between 1 and 50000.');
		} else throw new Error(`Unknown option: ${args[index]}`);
	}
	return { limit, apply };
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getPage(apiKey, cursor, count) {
	const url = new URL('https://partner.steam-api.com/IStoreService/GetAppList/v1/');
	url.searchParams.set('key', apiKey);
	url.searchParams.set(
		'input_json',
		JSON.stringify({
			include_games: true,
			include_dlc: false,
			include_software: false,
			include_videos: false,
			include_hardware: false,
			max_results: count,
			...(cursor ? { last_appid: cursor } : {})
		})
	);
	const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
	if (!response.ok) throw new Error(`Steam catalog returned HTTP ${response.status}.`);
	const payload = await response.json();
	const apps = payload?.response?.apps;
	if (!Array.isArray(apps)) throw new Error('Steam returned an unexpected catalog response.');
	return apps;
}

let client;
try {
	const options = parseArgs(process.argv.slice(2));
	const apiKey = process.env.STEAM_API_KEY;
	if (!apiKey) throw new Error('STEAM_API_KEY is required for the Steam catalog service.');
	const databaseConnection = resolveDatabaseUrl(options.apply ? 'steamWrite' : 'steamRead');
	await preflightDatabase(databaseConnection, {
		operation: options.apply ? 'steamWrite' : 'steamRead',
		requireLocalOwner: false
	});
	client = createDatabaseClient(databaseConnection.raw, 'vapourdb-steam-catalog-discovery');
	await client.connect();
	const connection = await client.query(
		'SELECT current_database() AS database, current_user AS role'
	);
	const databaseName = connection.rows[0]?.database;
	const databaseIdentity = identityForDatabase(databaseName);
	const testIdentity = testIdentityForDatabase(databaseName);
	const expectedRole =
		databaseConnection.mode === 'development'
			? databaseConnection.expectedRole
			: options.apply
				? databaseIdentity?.roles.importer
				: databaseIdentity?.roles.web;
	if (!databaseIdentity || connection.rows[0]?.role !== expectedRole)
		throw new Error('Refusing to update an unrecognized database.');
	if (testIdentity) {
		const marker = await client
			.query(`SELECT marker FROM public.${testIdentity.markerTable} WHERE id = 1`)
			.catch(() => ({ rows: [] }));
		if (marker.rows[0]?.marker !== testIdentity.markerValue)
			throw new Error('Refusing to update a test database without its disposable safety marker.');
	}

	let cursor = 0;
	let fetched = 0;
	let added = 0;
	let requests = 0;
	while (fetched < options.limit) {
		if (requests > 0)
			await delay(Math.max(2000, Number(process.env.STEAM_REQUEST_DELAY_MS) || 2000));
		const size = Math.min(1000, options.limit - fetched);
		const apps = await getPage(apiKey, cursor, size);
		requests += 1;
		if (!apps.length) break;
		const validApps = apps.filter(
			(app) => /^\d+$/.test(String(app.appid)) && typeof app.name === 'string' && app.name.trim()
		);
		fetched += apps.length;
		const lastId = Math.max(...apps.map((app) => Number(app.appid)).filter(Number.isFinite));
		if (!Number.isFinite(lastId) || lastId <= cursor)
			throw new Error('Steam returned an invalid AppID continuation value.');
		cursor = lastId;
		if (validApps.length) {
			const ids = validApps.map((app) => String(app.appid));
			const known = await client.query(
				'SELECT app_id FROM public.games WHERE app_id = ANY($1::text[])',
				[ids]
			);
			const existing = new Set(known.rows.map((row) => row.app_id));
			const newApps = validApps.filter((app) => !existing.has(String(app.appid)));
			if (options.apply) {
				for (let offset = 0; offset < newApps.length; offset += 250) {
					const batch = newApps.slice(offset, offset + 250);
					const values = [];
					const tuples = batch.map((app) => {
						const appId = String(app.appid);
						const first = values.length + 1;
						values.push(
							appId,
							app.name.trim(),
							slugify(app.name, appId),
							JSON.stringify({ steamCatalog: { lastModified: app.last_modified ?? null } })
						);
						return `($${first}::text, $${first + 1}::text, $${first + 2}::text, $${first + 3}::jsonb)`;
					});
					await client.query(
						`INSERT INTO public.games (app_id, title, slug, metadata) VALUES ${tuples.join(',')}
						 ON CONFLICT (app_id) DO NOTHING`,
						values
					);
				}
				added += newApps.length;
			} else added += newApps.length;
		}
		console.log(
			`Catalog page ${requests}: ${apps.length} items, ${validApps.length} named game entries.`
		);
		if (apps.length < size) break;
	}
	console.log(
		`${options.apply ? 'Added' : 'Would add'} ${added.toLocaleString()} new games from ${fetched.toLocaleString()} catalog entries in ${requests} request(s).`
	);
} catch (error) {
	console.error(`Steam catalog discovery failed: ${error.message}`);
	process.exitCode = 1;
} finally {
	if (client) await client.end().catch(() => {});
}
