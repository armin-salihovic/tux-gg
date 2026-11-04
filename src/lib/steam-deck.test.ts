import { describe, expect, it } from 'vitest';
import { steamDeckObservations } from './steam-deck.js';

describe('Steam Deck source responses', () => {
	it('formats supported source values and skips unknown values', () => {
		expect(
			steamDeckObservations({
				os: 'SteamOS Holo',
				batteryPerformance: 'yes',
				readability: 'no',
				didChangeControlLayout: 'yes',
				controlLayout: 'community',
				controlLayoutCustomization: 'no',
				frameRate: '30to60'
			})
		).toEqual([
			{ label: 'Reported system', value: 'SteamOS' },
			{ label: 'Battery performance acceptable', value: 'Yes' },
			{ label: 'Text readable', value: 'No' },
			{ label: 'Changed controller layout', value: 'Yes' },
			{ label: 'Controller layout', value: 'Community layout' },
			{ label: 'Customized layout', value: 'No' },
			{ label: 'Reported frame rate', value: '30–60 FPS' }
		]);
		expect(
			steamDeckObservations({
				os: null,
				batteryPerformance: 'arbitrary text',
				readability: null,
				didChangeControlLayout: null,
				controlLayout: 'unexpected',
				controlLayoutCustomization: null,
				frameRate: null
			})
		).toEqual([]);
	});
});
