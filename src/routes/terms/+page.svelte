<script lang="ts">
	import ContentPage from '#lib/components/ContentPage.svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
	const sections = [
		{
			title: 'Compatibility information',
			paragraphs: [
				'TuxGG provides community-reported compatibility information for reference. Results can be incomplete, outdated, mistaken, or specific to particular hardware and software. TuxGG does not guarantee that a game will run or meet a performance target.'
			]
		},
		{
			title: 'Third-party services and data',
			paragraphs: [
				'Discord sign-in is provided by Discord. Imported report data is attributed to ProtonDB and remains subject to the source database and content licenses. Steam store links are provided for convenience. Third-party services have their own terms and privacy practices.'
			]
		},
		{
			title: 'Contributions',
			paragraphs: [
				'Native community report publishing is not currently available. If it is enabled later, submission terms, moderation, removal, and licensing information must be presented before a report is accepted.'
			]
		},
		{
			title: 'Operator details',
			paragraphs: [
				'The public operator identity, jurisdiction, and support contact have not been configured in this development project. The deployment owner must supply those details and obtain appropriate legal review before opening the service to the public.'
			]
		}
	];
</script>

<ContentPage
	eyebrow="Terms"
	title="Terms of use"
	intro="These development terms describe the current scope and limitations of the TuxGG site."
	{sections}
	canonical={data.canonical}
/>
