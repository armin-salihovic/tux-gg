#!/usr/bin/env node

import pg from 'pg';
import { loadLocalEnv, MERGE_METADATA_FUNCTION, slugify } from './games-catalog.mjs';

loadLocalEnv();

function parseArgs(args) {
	const result = { ids: [], limit: 10, dryRun: false };
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === '--dry-run') result.dryRun = true;
		else if (arg === '--ids') {
			const value = args[++index];
			if (!value) throw new Error('--ids requires a comma-separated list of Steam AppIDs.');
			result.ids = value
				.split(/[\s,]+/)
				.map((id) => id.trim())
				.filter(Boolean);
		} else if (arg === '--limit') {
			const value = Number(args[++index]);
			if (!Number.isInteger(value) || value < 1 || value > 20)
				throw new Error('--limit must be between 1 and 20.');
			result.limit = value;
		} else throw new Error(`Unknown option: ${arg}`);
	}
	if (result.ids.length > 20 || result.ids.some((id) => !/^\d+$/.test(id)))
		throw new Error('--ids must contain up to 20 numeric AppIDs.');
	if (new Set(result.ids).size !== result.ids.length)
		throw new Error('--ids contains duplicate AppIDs.');
	if (result.ids.length && result.ids.length > result.limit)
		throw new Error('--ids cannot contain more games than --limit.');
	return result;
}

function wait(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function nonEmpty(value) {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeSteamDetails(data) {
	const details = {
		raw: data,
		name: nonEmpty(data.name),
		type: nonEmpty(data.type),
		shortDescription: nonEmpty(data.short_description),
		detailedDescription: nonEmpty(data.detailed_description),
		developers: Array.isArray(data.developers)
			? data.developers.filter((item) => typeof item === 'string' && item.trim())
			: [],
		publishers: Array.isArray(data.publishers)
			? data.publishers.filter((item) => typeof item === 'string' && item.trim())
			: [],
		releaseDate: nonEmpty(data.release_date?.date),
		genres: Array.isArray(data.genres)
			? data.genres.map(({ description }) => description).filter(Boolean)
			: [],
		categories: Array.isArray(data.categories)
			? data.categories.map(({ description }) => description).filter(Boolean)
			: [],
		platforms: data.platforms && typeof data.platforms === 'object' ? data.platforms : {},
		isFree: typeof data.is_free === 'boolean' ? data.is_free : null,
		capsuleImage: nonEmpty(data.capsule_image),
		headerImage: nonEmpty(data.header_image),
		website: nonEmpty(data.website),
		lastFetchedAt: new Date().toISOString()
	};
	return Object.fromEntries(
		Object.entries(details).filter(([, value]) => {
			if (value === null) return false;
			if (Array.isArray(value) && value.length === 0) return false;
			if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)
				return false;
			return true;
		})
	);
}

async function fetchDetails(appId) {
	const url = new URL('https://store.steampowered.com/api/appdetails');
	url.searchParams.set('appids', appId);
	url.searchParams.set('l', 'english');
	url.searchParams.set('cc', 'us');
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 20_000);
	try {
		const response = await fetch(url, {
			signal: controller.signal,
			headers: { 'user-agent': 'TuxGG Steam catalog sync (development)' }
		});
		if (!response.ok) throw new Error(`Steam returned HTTP ${response.status}.`);
		const payload = await response.json();
		const item = payload?.[appId];
		if (!item?.success || !item?.data || typeof item.data !== 'object')
			return { appId, status: 'unavailable', data: null };
		return { appId, status: 'ok', data: item.data };
	} finally {
		clearTimeout(timeout);
	}
}

let client;
try {
	const options = parseArgs(process.argv.slice(2));
	const connectionString = options.dryRun
		? process.env.DATABASE_URL
		: process.env.IMPORTER_DATABASE_URL;
	if (!connectionString)
		throw new Error(
			`${options.dryRun ? 'DATABASE_URL' : 'IMPORTER_DATABASE_URL'} is not configured.`
		);
	client = new pg.Client({ connectionString, application_name: 'tuxgg-steam-metadata-sync' });
	await client.connect();
	const identity = await client.query('SELECT current_database() AS database');
	if (!['tuxgg', 'tuxgg_test'].includes(identity.rows[0]?.database))
		throw new Error('Refusing to sync against an unrecognized database.');
	let ids = options.ids;
	if (!ids.length) {
		const selected = await client.query(
			`SELECT app_id FROM public.games
			 ORDER BY CASE WHEN title IS NULL OR artwork_url IS NULL OR metadata = '{}'::jsonb THEN 0 ELSE 1 END,
			          updated_at DESC, app_id ASC
			 LIMIT $1`,
			[options.limit]
		);
		ids = selected.rows.map((row) => row.app_id);
	}
	if (ids.length === 0)
		throw new Error('No games are present in public.games. Restore the games CSV first.');

	const delayMs = Math.max(2000, Number(process.env.STEAM_REQUEST_DELAY_MS) || 2000);
	console.log(
		`Refreshing ${ids.length} existing Steam app(s) with a ${delayMs} ms minimum delay${options.dryRun ? ' (dry run)' : ''}.`
	);
	if (!options.dryRun) await client.query(MERGE_METADATA_FUNCTION);
	const results = [];
	for (const [index, appId] of ids.entries()) {
		if (index > 0) await wait(delayMs);
		const result = await fetchDetails(appId);
		if (result.status === 'ok') {
			const name = nonEmpty(result.data.name);
			const steamMetadata = normalizeSteamDetails(result.data);
			if (!options.dryRun) {
				await client.query(
					`INSERT INTO public.games (app_id, title, slug, artwork_url, header_image_url, metadata)
					 VALUES ($1, $2, $3, $4, $5, $6::jsonb)
					 ON CONFLICT (app_id) DO UPDATE SET
					   title = COALESCE(NULLIF(EXCLUDED.title, ''), public.games.title),
					   slug = COALESCE(NULLIF(public.games.slug, ''), EXCLUDED.slug),
					   artwork_url = COALESCE(NULLIF(EXCLUDED.artwork_url, ''), public.games.artwork_url),
					   header_image_url = COALESCE(NULLIF(EXCLUDED.header_image_url, ''), public.games.header_image_url),
					   metadata = pg_temp.tuxgg_merge_metadata(public.games.metadata, EXCLUDED.metadata),
					   updated_at = now()`,
					[
						appId,
						name,
						slugify(name, appId),
						nonEmpty(result.data.capsule_image),
						nonEmpty(result.data.header_image),
						JSON.stringify({ steam: steamMetadata })
					]
				);
			}
			results.push({
				appId,
				title: name,
				status: options.dryRun ? 'available; not written' : 'updated'
			});
		} else results.push({ appId, title: null, status: 'Steam details unavailable' });
		console.log(
			`${appId}: ${result.status === 'ok' ? (nonEmpty(result.data.name) ?? 'name unavailable') : result.status}`
		);
	}
	console.log(
		`Finished: ${results.filter((result) => result.status === 'updated' || result.status === 'available; not written').length} available, ${results.filter((result) => result.status === 'Steam details unavailable').length} unavailable.`
	);
} catch (error) {
	const detail =
		error instanceof Error
			? `${error.name}${error.message ? `: ${error.message}` : ''}`
			: String(error);
	console.error(`Steam metadata sync failed: ${detail}`);
	process.exitCode = 1;
} finally {
	if (client) await client.end().catch(() => {});
}
