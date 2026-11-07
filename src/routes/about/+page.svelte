<script lang="ts">
	import ContentPage from '#lib/components/ContentPage.svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
	const sections = [
		{
			title: 'A Steam-first game catalog',
			paragraphs: [
				'TuxGG keeps a searchable catalog keyed by Steam AppID. Existing titles, slugs, artwork, and metadata are preserved, while Steam store data can fill gaps and refresh changing details.',
				'Game pages link to Steam and show the metadata available for that catalog entry.'
			]
		},
		{
			title: 'Community reports',
			paragraphs: [
				'Steam-authenticated players can submit Linux and Steam Deck reports with a verdict and optional system details. Reports stay private while pending and become public only after operator review.',
				'Reports describe an individual setup and experience. They are not a guarantee that a game will work on another system.'
			]
		}
	];
</script>

<ContentPage
	eyebrow="About TuxGG"
	title="Make Linux game compatibility easier to understand"
	intro="TuxGG combines a Steam game catalog with player-submitted Linux and Steam Deck reports."
	{sections}
	canonical={data.canonical}
/>
