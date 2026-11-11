<script lang="ts">
	import ContentPage from '#lib/components/ContentPage.svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
	const sections = [
		{
			title: 'Player-reported outcomes',
			paragraphs: [
				'Each VapourDB report describes one player’s experience on a Linux desktop or Steam Deck. The author selects whether the game worked for that setup and can add Proton, distribution, hardware, performance, or issue details.',
				'VapourDB shows each public report with its verdict and setup details and calculates a compatibility tier from community yes/no reports. Every visible report has the same effect. Each report uses its submission date for the 365-day half-life, so later moderation does not refresh its weight. Compare hardware and software details before applying an outcome to your own system.'
			]
		},
		{
			title: 'Publication and moderation',
			paragraphs: [
				'New reports are public immediately and count toward report totals and compatibility tiers. Operators may moderate reports afterward, and hidden or removed reports are excluded from public lists, counts, filters, and compatibility calculations on the next query. An inaccurate or malicious report may affect a tier temporarily until it is hidden or removed. A tier requires at least three recency-weighted reports and an effective sample size of three.',
				'Reports can be incomplete or outdated and do not represent an official Steam or Valve verification.'
			]
		}
	];
</script>

<ContentPage
	eyebrow="Community reports"
	title="How VapourDB reports work"
	intro="VapourDB publishes community reports immediately and allows operators to moderate them afterward."
	{sections}
	canonical={data.canonical}
/>
