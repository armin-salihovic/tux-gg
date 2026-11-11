<script lang="ts">
	import ContentPage from '#lib/components/ContentPage.svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
	const sections = [
		{
			title: 'A Steam-first game catalog',
			paragraphs: [
				'VapourDB keeps a searchable catalog keyed by Steam AppID. Existing titles, slugs, artwork, and metadata are preserved, while Steam store data can fill gaps and refresh changing details.',
				'Game pages link to Steam and show the metadata available for that catalog entry.'
			]
		},
		{
			title: 'Community reports',
			paragraphs: [
				'Steam-authenticated players can submit Linux and Steam Deck reports with a verdict and optional system details. Reports appear publicly as soon as they are submitted and may be hidden or removed by an operator later. The author’s public VapourDB username and chosen device details appear with the report.',
				'Reports describe an individual setup and experience. They are not a guarantee that a game will work on another system.'
			]
		}
	];
</script>

<ContentPage
	eyebrow="About VapourDB"
	title="Make Linux game compatibility easier to understand"
	intro="VapourDB combines a Steam game catalog with player-submitted Linux and Steam Deck reports."
	{sections}
	canonical={data.canonical}
/>
