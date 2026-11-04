<script lang="ts">
	import ContentPage from '#lib/components/ContentPage.svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
	const sections = [
		{
			title: 'Be useful and accurate',
			paragraphs: [
				'Describe the game version, Linux distribution, hardware, driver, Proton build, launch options, and relevant steps when sharing compatibility information. Say when a result is uncertain or only applies to one setup.'
			]
		},
		{
			title: 'Respect other people',
			paragraphs: [
				'Do not post harassment, threats, hate speech, sexual exploitation, or private personal information. Do not impersonate another player or claim someone else’s report as your own.'
			]
		},
		{
			title: 'Keep reports safe to display',
			paragraphs: [
				'Do not include passwords, access tokens, private messages, email addresses, or information that identifies another person. Do not use reports to advertise, distribute malware, or evade moderation.'
			]
		},
		{
			title: 'Moderation and reporting',
			paragraphs: [
				'Native report publishing and moderation are not enabled yet. When contributions launch, TuxGG should provide a reporting and removal process and publish the moderation policy before accepting submissions.'
			]
		}
	];
</script>

<ContentPage
	eyebrow="Community"
	title="Community rules"
	intro="These rules set expectations for useful, respectful, and privacy-conscious compatibility reports."
	{sections}
	canonical={data.canonical}
/>
