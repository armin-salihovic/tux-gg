<script lang="ts">
	import ContentPage from '#lib/components/ContentPage.svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
	const sections = [
		{
			title: 'ProtonDB report exports',
			paragraphs: [
				'The local corpus combines the last available flat-schema export before the October 2019 questionnaire change with the newest nested-schema snapshot in the project. These are cumulative snapshots, so the importer does not replay every monthly archive.',
				'Imported entries are visibly labeled ProtonDB, and game pages link back to the ProtonDB source. TuxGG does not invent report IDs or author identities. Source comments are displayed as escaped plain text, with email-shaped strings redacted by the importer.'
			]
		},
		{
			title: 'Attribution and database licenses',
			paragraphs: [
				'The source README identifies the reports database as ODbL 1.0 and individual database contents as DbCL 1.0. Redistribution of the imported or adapted database must retain attribution and comply with the applicable share-alike terms. These licenses cover source data and database rights; they do not license TuxGG application code.',
				'TuxGG attribution: report data derived from ProtonDB exports. Individual reports link to ProtonDB when viewed in the catalog.'
			]
		},
		{
			title: 'Steam artwork',
			paragraphs: [
				'The export includes app IDs and titles, but not descriptions, artwork, developers, publishers, or release details. TuxGG constructs Steam CDN artwork URLs from app IDs and uses a local fallback when artwork is unavailable. Artwork remains hosted by Steam; the Steam Subscriber Agreement does not clearly confirm a general right to embed it on a public third-party website. Public deployment requires the operator to confirm or obtain the needed rights. TuxGG does not scrape store pages or request a metadata API.'
			]
		},
		{
			title: 'Local analysis',
			paragraphs: [
				'The project includes a reproducible schema, coverage, deduplication, exclusion, scoring, and privacy analysis in docs/data-analysis.md. It documents that only records whose primary OS field identifies ChromeOS or Chromebook are excluded; SteamOS and Steam Deck fields are retained.'
			]
		}
	];
</script>

<ContentPage
	eyebrow="Provenance"
	title="Data sources and attribution"
	intro="See where TuxGG’s compatibility evidence comes from and how imported reports are handled."
	{sections}
	canonical={data.canonical}
/>
<div class="container-shell -mt-5 max-w-4xl pb-14 text-sm">
	<div class="surface rounded-2xl p-6 text-slate-300">
		<p>
			License texts: <a
				class="text-mint underline"
				href="https://opendatacommons.org/licenses/odbl/1-0/"
				rel="noopener noreferrer"
				target="_blank">ODbL 1.0</a
			>
			and
			<a
				class="text-mint underline"
				href="https://opendatacommons.org/licenses/dbcl/1-0/"
				rel="noopener noreferrer"
				target="_blank">DbCL 1.0</a
			>. Source project:
			<a
				class="text-mint underline"
				href="https://www.protondb.com/"
				rel="noopener noreferrer"
				target="_blank">ProtonDB</a
			>.
		</p>
	</div>
</div>
