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
				'Steam OpenID sign-in and Steam store metadata are provided by Steam services. Steam store links and artwork are provided for convenience and remain subject to Steam’s terms and asset policies. Third-party services have their own terms and privacy practices.'
			]
		},
		{
			title: 'Contributions',
			paragraphs: [
				'You may submit reports describing your own game experience and setup. Reports begin in private review, and operators may publish, hide, or remove them. Do not submit personal information or content you do not have permission to share.'
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
