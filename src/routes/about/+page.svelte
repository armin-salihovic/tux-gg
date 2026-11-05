<script lang="ts">
	import ContentPage from '#lib/components/ContentPage.svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
	const sections = [
		{
			title: 'A practical compatibility guide',
			paragraphs: [
				'TuxGG helps Linux and Steam Deck players find reports from people running the same games. Each game page brings together the reported outcome, Proton build, distribution, GPU, driver, launch options, and notes.',
				'The app currently imports ProtonDB data. Imported reports are labeled and linked to their source; their authors are not presented as TuxGG users.'
			]
		},
		{
			title: 'How to read the tier',
			paragraphs: [
				'TuxGG calculates its own recency-weighted compatibility tier from recognized source ratings and verdicts. A tier is only shown when there is enough recent evidence, and the page keeps report counts and source distributions visible for context.',
				'The tier is a summary of community reports, not a guarantee that a game will work on a particular system. Your hardware, software versions, and game updates can change the result.'
			]
		},
		{
			title: 'Community reports',
			paragraphs: [
				'Steam OpenID sign-in supports a public account profile. Publishing native reports is disabled because Steam identity alone does not verify ownership of a particular game. The database keeps a separate model for future native reports so those contributions will remain distinct from imported ProtonDB reports.'
			]
		}
	];
</script>

<ContentPage
	eyebrow="About TuxGG"
	title="Make Linux game compatibility easier to understand"
	intro="TuxGG brings community compatibility reports and system details into one searchable catalog."
	{sections}
	canonical={data.canonical}
/>
