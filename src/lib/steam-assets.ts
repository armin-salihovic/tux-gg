const STEAM_APP_ID_MAX = 4_294_967_295;
const STEAM_ASSET_ORIGIN = 'https://shared.fastly.steamstatic.com';

const TRUSTED_STEAM_ASSET_HOSTS = new Set([
	'shared.fastly.steamstatic.com',
	'shared.cloudflare.steamstatic.com',
	'shared.akamai.steamstatic.com',
	'shared.steamstatic.com',
	'steamcdn-a.akamaihd.net'
]);

export type SteamArtworkVariant = 'header' | 'thumbnail';

export function isValidSteamAppId(appId: string): boolean {
	if (!/^[1-9]\d{0,9}$/.test(appId)) return false;
	const numericId = Number(appId);
	return Number.isSafeInteger(numericId) && numericId <= STEAM_APP_ID_MAX;
}

export function getSteamHeaderUrl(appId: string): string | null {
	if (!isValidSteamAppId(appId)) return null;
	return `${STEAM_ASSET_ORIGIN}/store_item_assets/steam/apps/${appId}/header.jpg`;
}

export function getSteamThumbnailUrl(appId: string): string | null {
	if (!isValidSteamAppId(appId)) return null;
	return `${STEAM_ASSET_ORIGIN}/store_item_assets/steam/apps/${appId}/capsule_616x353.jpg`;
}

export function getTrustedSteamArtworkUrl(
	url: string | null | undefined,
	appId: string
): string | null {
	if (!url || !isValidSteamAppId(appId)) return null;

	try {
		const parsed = new URL(url);
		if (
			parsed.protocol !== 'https:' ||
			!TRUSTED_STEAM_ASSET_HOSTS.has(parsed.hostname.toLowerCase()) ||
			parsed.username ||
			parsed.password ||
			(parsed.port && parsed.port !== '443')
		) {
			return null;
		}

		const expectedPathPrefixes = [
			`/store_item_assets/steam/apps/${appId}/`,
			`/steam/apps/${appId}/`
		];
		return expectedPathPrefixes.some((prefix) => parsed.pathname.startsWith(prefix)) ? url : null;
	} catch {
		return null;
	}
}

export function getSteamArtworkCandidates(
	appId: string,
	variant: SteamArtworkVariant,
	preferredUrl?: string | null
): string[] {
	if (!isValidSteamAppId(appId)) return [];

	const primary = variant === 'header' ? getSteamHeaderUrl(appId) : getSteamThumbnailUrl(appId);
	const secondary = variant === 'header' ? getSteamThumbnailUrl(appId) : getSteamHeaderUrl(appId);
	const trustedPreferred = getTrustedSteamArtworkUrl(preferredUrl, appId);

	return [
		...new Set([trustedPreferred, primary, secondary].filter((url): url is string => Boolean(url)))
	];
}

export function getNextSteamArtworkIndex(
	currentIndex: number,
	candidateCount: number
): number | null {
	if (
		!Number.isInteger(currentIndex) ||
		!Number.isInteger(candidateCount) ||
		currentIndex < 0 ||
		candidateCount < 1
	) {
		return null;
	}
	return currentIndex + 1 < candidateCount ? currentIndex + 1 : null;
}
