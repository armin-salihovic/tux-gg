<script lang="ts">
	import ContentPage from '#lib/components/ContentPage.svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
	const sections = [
		{
			title: 'Player-reported outcomes',
			paragraphs: [
				'Each VapourDB report describes one player’s experience on a Linux desktop or Steam Deck. The author selects whether the game worked for that setup and can add Proton, distribution, hardware, performance, or issue details.',
				'VapourDB shows published reports individually instead of combining them into a single compatibility score. Compare the hardware and software details before applying an outcome to your own system.'
			]
		},
		{
			title: 'Review and publication',
			paragraphs: [
				'New reports are private and pending review. An operator can publish, hide, or remove a report. Only published reports appear publicly or contribute to the visible yes and no counts.',
				'Reports can be incomplete or outdated and do not represent an official Steam or Valve verification.'
			]
		}
	];
</script>

<ContentPage
	eyebrow="Community reports"
	title="How VapourDB reports work"
	intro="VapourDB displays player experiences with their reported setup details and moderation status."
	{sections}
	canonical={data.canonical}
/>
