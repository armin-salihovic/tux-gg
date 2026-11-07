<script lang="ts">
	import ContentPage from '#lib/components/ContentPage.svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
	const sections = [
		{
			title: 'Preserved games catalog',
			paragraphs: [
				'TuxGG preserves the existing Steam AppIDs, titles, slugs, artwork URLs, full metadata JSON, and creation and update timestamps in its games catalog. The complete table is exported as a PostgreSQL archive and UTF-8 CSV before schema cleanup.',
				'The CSV restore uses AppID upserts and recursively merges metadata so fields from older imports remain available.'
			]
		},
		{
			title: 'Steam store metadata',
			paragraphs: [
				'The catalog refresh command requests Steam store details only for a small selected set of existing AppIDs. It updates non-empty Steam metadata and artwork without replacing unrelated metadata fields.',
				'Catalog discovery uses Steamworks IStoreService/GetAppList to add new AppIDs and names in pages. It skips games already in the local catalog and does not request per-game details during discovery.'
			]
		},
		{
			title: 'TuxGG community reports',
			paragraphs: [
				'Compatibility reports are submitted by signed-in TuxGG users. Pending reports remain private; published reports show their author and the submitted setup details. TuxGG reports are separate from Steam store metadata.'
			]
		},
		{
			title: 'Steam artwork',
			paragraphs: [
				'Existing artwork URLs are retained. The client uses allowlisted Steam image URLs and a local fallback when an image is missing. Steam store links and images remain subject to Steam’s terms and asset policies.'
			]
		}
	];
</script>

<ContentPage
	eyebrow="Provenance"
	title="Data sources and attribution"
	intro="TuxGG preserves its existing games catalog, refreshes selected details from Steam, and hosts its own player reports."
	{sections}
	canonical={data.canonical}
/>
