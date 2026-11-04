<script lang="ts">
	import ContentPage from '#lib/components/ContentPage.svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
	const sections = [
		{
			title: 'Signals and values',
			paragraphs: [
				'Modern ProtonDB yes/no verdicts map to 1.00 and 0.00. Legacy Platinum, Gold, Silver, Bronze, and Borked ratings map to 1.00, 0.80, 0.60, 0.35, and 0.00. Unknown or unsupported signals do not affect the tier. The source value remains visible on each report.'
			]
		},
		{
			title: 'Recency and minimum evidence',
			paragraphs: [
				'Each recognized report receives a 365-day half-life weight: 2^(-age in days / 365). Future-dated reports are treated as age zero. The weighted score is the sum of weight × value divided by the sum of weights.',
				'A tier is withheld as Unknown until both the sum of weights and effective sample size are at least 3. Effective sample size is (sum of weights)² / sum of squared weights. This reduces the influence of one old or isolated report.'
			]
		},
		{
			title: 'Tier thresholds',
			paragraphs: [
				'Once the evidence gate is met, TuxGG maps the weighted score to an easy-to-read tier. These thresholds are project methodology, not official ProtonDB categories.'
			],
			bullets: [
				'Platinum: 0.95 or higher',
				'Gold: 0.80 to less than 0.95',
				'Silver: 0.60 to less than 0.80',
				'Bronze: 0.30 to less than 0.60',
				'Borked: below 0.30'
			]
		},
		{
			title: 'Limitations',
			paragraphs: [
				'Reports from the two questionnaire eras use different signals. Source verdicts and ratings are preserved separately, but the TuxGG score combines their documented numeric mappings. The method does not account for GPU model, launch options, anti-cheat responses, or free-text sentiment.',
				'The tier should be read alongside the number, age, and distribution of reports. It is a community-data summary and does not promise compatibility or performance.'
			]
		}
	];
</script>

<ContentPage
	eyebrow="Scoring"
	title="TuxGG rating methodology"
	intro="The compatibility tier is a transparent recency-weighted heuristic over recognized ProtonDB report signals."
	{sections}
	canonical={data.canonical}
/>
