<script lang="ts">
	import ContentPage from '#lib/components/ContentPage.svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
	const sections = $derived([
		{
			title: data.contactEmail ? 'Project support' : 'Contact details are not configured',
			paragraphs: [
				data.contactEmail
					? 'Use this monitored address for project support, privacy requests, and data corrections.'
					: 'This project does not contain a support mailbox or public operator contact yet. A deployment owner should configure a monitored contact address before launch, especially for privacy requests and data corrections.'
			]
		},
		{
			title: 'Project information',
			paragraphs: [
				'Imported reports link to ProtonDB for source context. The source code and local data analysis are documented in the project workspace.'
			]
		}
	]);
</script>

<ContentPage
	eyebrow="Contact"
	title="Get in touch"
	intro={data.contactEmail
		? 'Reach the TuxGG project team for support, privacy requests, or data corrections.'
		: 'TuxGG needs a project contact channel before it can accept public support or privacy requests.'}
	{sections}
	canonical={data.canonical}
/>
{#if data.contactEmail}<div class="container-shell -mt-5 max-w-4xl pb-14">
		<a
			class="inline-flex rounded-xl bg-mint px-5 py-3 text-sm font-extrabold text-ink"
			href={`mailto:${data.contactEmail}`}>{data.contactEmail}</a
		>
	</div>{/if}
