import { describe, expect, it } from 'vitest';
import {
	getNextSteamArtworkIndex,
	getSteamArtworkCandidates,
	getSteamHeaderUrl,
	getSteamThumbnailUrl,
	getTrustedSteamArtworkUrl,
	isValidSteamAppId
} from './steam-assets.js';

describe('Steam artwork URLs', () => {
	it('constructs artwork URLs for known Steam app IDs', () => {
		expect(getSteamHeaderUrl('440')).toBe(
			'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/440/header.jpg'
		);
		expect(getSteamThumbnailUrl('570')).toBe(
			'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/570/capsule_616x353.jpg'
		);
		expect(getSteamHeaderUrl('730')).toContain('/apps/730/header.jpg');
	});

	it('accepts canonical unsigned 32-bit Steam app IDs only', () => {
		for (const appId of ['1', '440', '4294967295']) expect(isValidSteamAppId(appId)).toBe(true);
		for (const appId of ['', '0', '0440', '-1', '1.5', '4294967296', '12345678901', 'app/440']) {
			expect(isValidSteamAppId(appId)).toBe(false);
		}
	});

	it('rejects unsafe, non-HTTPS, and cross-app artwork URLs', () => {
		expect(
			getTrustedSteamArtworkUrl(
				'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/440/header.jpg',
				'440'
			)
		).not.toBeNull();
		expect(
			getTrustedSteamArtworkUrl(
				'http://shared.fastly.steamstatic.com/steam/apps/440/header.jpg',
				'440'
			)
		).toBeNull();
		expect(getTrustedSteamArtworkUrl('https://attacker.example/440.jpg', '440')).toBeNull();
		expect(
			getTrustedSteamArtworkUrl(
				'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/570/header.jpg',
				'440'
			)
		).toBeNull();
	});

	it('uses trusted existing artwork first, then generated size and alternate fallback', () => {
		const preferred =
			'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/440/header.jpg';
		expect(getSteamArtworkCandidates('440', 'thumbnail', preferred)).toEqual([
			preferred,
			getSteamThumbnailUrl('440'),
			getSteamHeaderUrl('440')
		]);
		expect(
			getSteamArtworkCandidates('440', 'header', 'https://attacker.example/image.jpg')
		).toEqual([getSteamHeaderUrl('440'), getSteamThumbnailUrl('440')]);
		expect(getSteamArtworkCandidates('not-an-id', 'header')).toEqual([]);
	});

	it('advances through image errors and stops after the final candidate', () => {
		expect(getNextSteamArtworkIndex(0, 2)).toBe(1);
		expect(getNextSteamArtworkIndex(1, 2)).toBeNull();
		expect(getNextSteamArtworkIndex(0, 0)).toBeNull();
	});
});
