<script lang="ts">
	export interface ContentSection {
		title: string;
		paragraphs: string[];
		bullets?: string[];
	}
	let {
		title,
		eyebrow,
		intro,
		sections,
		canonical
	}: {
		title: string;
		eyebrow: string;
		intro: string;
		sections: ContentSection[];
		canonical?: string;
	} = $props();
</script>

<svelte:head>
	<title>{title} | TuxGG</title>
	<meta name="description" content={intro} />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="TuxGG" />
	<meta property="og:title" content={`${title} | TuxGG`} />
	<meta property="og:description" content={intro} />
	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content={`${title} | TuxGG`} />
	<meta name="twitter:description" content={intro} />
	{#if canonical}<link rel="canonical" href={canonical} /><meta
			property="og:url"
			content={canonical}
		/>{/if}
</svelte:head>

<article class="container-shell max-w-4xl py-12 sm:py-16">
	<p class="eyebrow">{eyebrow}</p>
	<h1 class="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">{title}</h1>
	<p class="mt-4 max-w-3xl leading-7 text-base text-slate-300">{intro}</p>
	<div class="mt-9 space-y-4">
		{#each sections as section}<section class="surface rounded-2xl p-6 sm:p-7">
				<h2 class="text-lg font-bold text-white">{section.title}</h2>
				<div class="mt-3 space-y-3 text-sm leading-7 text-slate-300">
					{#each section.paragraphs as paragraph}<p>{paragraph}</p>{/each}
				</div>
				{#if section.bullets}<ul
						class="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-300"
					>
						{#each section.bullets as bullet}<li>{bullet}</li>{/each}
					</ul>{/if}
			</section>{/each}
	</div>
</article>
