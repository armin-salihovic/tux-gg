<script lang="ts">
	import type { PageData } from './$types';
	import CompatibilityBadge from '#lib/components/CompatibilityBadge.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import ReportCard from '#lib/components/ReportCard.svelte';
	let { data }: { data: PageData } = $props();
	const gamePath = $derived(
		data.game ? `/games/${data.game.appId}/${data.game.slug}` : `/games/${data.appId}`
	);
	function pageHref(page: number) {
		const p = new URLSearchParams();
		for (const key of ['gpu', 'distribution', 'proton', 'verdict', 'since', 'until']) {
			const value = data.query?.[key as keyof typeof data.query];
			if (typeof value === 'string' && value) p.set(key, value);
		}
		if (page > 1) p.set('page', String(page));
		return `${gamePath}${p.size ? `?${p}` : ''}`;
	}
	const jsonLd = $derived(
		data.available && data.game
			? JSON.stringify({
					'@context': 'https://schema.org',
					'@type': 'VideoGame',
					name: data.game.title,
					identifier: data.game.appId,
					url: data.canonical,
					gamePlatform: ['Linux', 'Steam Deck'],
					sameAs: `https://store.steampowered.com/app/${data.game.appId}/`,
					additionalProperty: [
						{ '@type': 'PropertyValue', name: 'TuxGG compatibility tier', value: data.game.tier }
					]
				}).replace(/</g, '\\u003c')
			: ''
	);
	const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });
</script>

<svelte:head>
	<title
		>{data.available && data.game
			? `${data.game.title} Linux Compatibility | TuxGG`
			: `Game ${data.appId} | TuxGG`}</title
	>
	<meta
		name="description"
		content={data.available && data.game
			? data.description
			: 'Game compatibility details are temporarily unavailable.'}
	/>
	<link rel="canonical" href={data.canonical} />
	{#if data.filtered || !data.available || (data.reportData?.total ?? 0) < 3}<meta
			name="robots"
			content="noindex,follow"
		/>{/if}
	{#if data.available && data.game}
		<meta property="og:type" content="website" />
		<meta property="og:title" content={`${data.game.title} Linux Compatibility | TuxGG`} />
		<meta property="og:description" content={data.description} />
		<meta property="og:url" content={data.canonical} />
		<meta name="twitter:title" content={`${data.game.title} Linux Compatibility | TuxGG`} />
		<meta name="twitter:description" content={data.description} />
		{#if data.game.headerImageUrl}<meta
				property="og:image"
				content={data.game.headerImageUrl}
			/><meta name="twitter:card" content="summary_large_image" /><meta
				name="twitter:image"
				content={data.game.headerImageUrl}
			/>{:else}<meta name="twitter:card" content="summary" />{/if}
		<!-- prettier-ignore -->
		<script type="application/ld+json">
{@html jsonLd}
		</script>
	{/if}
</svelte:head>

{#if !data.available || !data.game}
	<section class="container-shell py-16">
		<div class="rounded-2xl border border-amber-200/20 bg-amber-200/[0.05] p-6 text-amber-100">
			Game data is temporarily unavailable. Please refresh in a moment.
		</div>
	</section>
{:else}
	<section class="container-shell pt-8 sm:pt-12">
		<nav class="text-xs text-muted" aria-label="Breadcrumb">
			<a class="hover:text-mint" href="/games">Games</a><span class="px-2 text-slate-600">/</span
			><span>{data.game.title}</span>
		</nav>
		<div class="surface relative mt-5 overflow-hidden rounded-3xl">
			{#if data.game.headerImageUrl}<img
					class="absolute inset-0 size-full object-cover opacity-20"
					src={data.game.headerImageUrl}
					alt=""
				/>{/if}
			<div class="absolute inset-0 bg-gradient-to-r from-base via-base/95 to-base/60"></div>
			<div class="relative grid gap-7 p-6 sm:grid-cols-[1fr_auto] sm:items-end sm:p-10">
				<div>
					<p class="eyebrow">Steam app {data.game.appId} · Linux compatibility</p>
					<h1 class="mt-3 max-w-3xl text-3xl font-black tracking-tight text-white sm:text-5xl">
						{data.game.title}
					</h1>
					<div class="mt-5 flex flex-wrap items-center gap-3">
						<CompatibilityBadge tier={data.game.tier} /><span class="text-sm text-slate-300"
							>{data.game.reportCount.toLocaleString()} imported reports</span
						>
						{#if data.game.lastReportAt}<span class="text-xs text-muted"
								>Latest: {dateFormat.format(data.game.lastReportAt)}</span
							>{/if}
					</div>
					<p class="mt-4 max-w-2xl text-sm leading-6 text-slate-300">
						TuxGG’s summary uses source verdicts and ratings with a 365-day half-life. Read
						individual reports below for the setups and issues behind it.
					</p>
					<div class="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-300">
						<span>Source yes: <strong class="text-mint">{data.game.yesCount ?? 0}</strong></span
						><span>Source no: <strong class="text-rose-200">{data.game.noCount ?? 0}</strong></span
						>{#each ['platinum', 'gold', 'silver', 'bronze', 'borked'] as rating}<span
								class="capitalize"
								>{rating}:
								<strong class="text-white">{data.game.verdictDistribution?.[rating] ?? 0}</strong
								></span
							>{/each}
					</div>
				</div>
				<div class="flex flex-wrap gap-2 sm:justify-end">
					<a
						class="rounded-xl border border-white/15 bg-black/20 px-4 py-2.5 text-sm font-semibold text-white hover:border-mint/40"
						href={`https://store.steampowered.com/app/${data.game.appId}/`}
						target="_blank"
						rel="noopener noreferrer">Steam page ↗</a
					><a
						class="rounded-xl border border-white/15 bg-black/20 px-4 py-2.5 text-sm font-semibold text-white hover:border-mint/40"
						href={`https://www.protondb.com/app/${data.game.appId}`}
						target="_blank"
						rel="noopener noreferrer">Source on ProtonDB ↗</a
					>
				</div>
			</div>
		</div>
	</section>

	<section class="container-shell mt-10 grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
		<div>
			<div class="flex flex-wrap items-end justify-between gap-3">
				<div>
					<p class="eyebrow">Player experience</p>
					<h2 class="mt-2 text-2xl font-extrabold text-white">Compatibility reports</h2>
				</div>
				<span class="text-xs text-muted">Imported ProtonDB reports are labeled below.</span>
			</div>
			{#if !data.reportData}
				<div
					class="mt-5 rounded-2xl border border-amber-200/20 bg-amber-200/[0.05] p-5 text-sm text-amber-100"
				>
					Report details are temporarily unavailable.
				</div>
			{:else if data.reportData.reports.length}
				<div class="mt-5 grid gap-4">
					{#each data.reportData.reports as report (report.id)}<ReportCard {report} />{/each}
				</div>
				<nav class="mt-7 flex items-center justify-between gap-3" aria-label="Report pages">
					{#if data.reportData.page > 1}<a
							class="rounded-xl border border-line px-4 py-2 text-sm text-white hover:border-mint/40"
							href={pageHref(data.reportData.page - 1)}>← Previous</a
						>{:else}<span></span>{/if}
					<span class="text-xs text-muted"
						>Page {data.reportData.page} of {data.reportData.pageCount}</span
					>
					{#if data.reportData.page < data.reportData.pageCount}<a
							class="rounded-xl border border-line px-4 py-2 text-sm text-white hover:border-mint/40"
							href={pageHref(data.reportData.page + 1)}>Next →</a
						>{:else}<span></span>{/if}
				</nav>
			{:else}
				<div class="mt-5">
					<EmptyState
						title="No reports match these filters"
						description="Adjust the filters or clear them to see all imported reports."
						actionHref={`/games/${data.game.appId}/${data.game.slug}`}
						actionLabel="Clear filters"
					/>
				</div>
			{/if}
		</div>
		<aside class="space-y-4">
			<form method="GET" class="surface rounded-2xl p-5">
				<h2 class="font-bold text-white">Filter reports</h2>
				<label class="mt-4 block text-xs font-semibold text-slate-300" for="gpu">GPU vendor</label
				><select
					id="gpu"
					name="gpu"
					class="mt-2 w-full rounded-xl border border-line bg-panel px-3 py-2.5 text-sm text-slate-200"
					><option value="">Any vendor</option>{#each data.filters.gpuVendors as value}<option
							{value}
							selected={data.query?.gpuVendor === value}>{value}</option
						>{/each}</select
				>
				<label class="mt-4 block text-xs font-semibold text-slate-300" for="distribution"
					>Distribution</label
				><select
					id="distribution"
					name="distribution"
					class="mt-2 w-full rounded-xl border border-line bg-panel px-3 py-2.5 text-sm text-slate-200"
					><option value="">Any distribution</option
					>{#each data.filters.distributions as value}<option
							{value}
							selected={data.query?.distribution === value}>{value}</option
						>{/each}</select
				>
				<label class="mt-4 block text-xs font-semibold text-slate-300" for="proton"
					>Proton version or variant</label
				><select
					id="proton"
					name="proton"
					class="mt-2 w-full rounded-xl border border-line bg-panel px-3 py-2.5 text-sm text-slate-200"
					><option value="">Any Proton build</option
					>{#each data.filters.proton as option (option.value)}<option
							value={option.value}
							selected={data.query?.proton === option.value}>{option.label}</option
						>{/each}</select
				>
				<label class="mt-4 block text-xs font-semibold text-slate-300" for="verdict"
					>Source verdict</label
				><select
					id="verdict"
					name="verdict"
					class="mt-2 w-full rounded-xl border border-line bg-panel px-3 py-2.5 text-sm text-slate-200"
					><option value="">Any verdict</option><option
						value="yes"
						selected={data.query?.verdict === 'yes'}>Works</option
					><option value="no" selected={data.query?.verdict === 'no'}>Does not work</option></select
				>
				<div class="mt-4 grid grid-cols-2 gap-2">
					<label class="text-xs font-semibold text-slate-300" for="since"
						>Since<input
							id="since"
							name="since"
							type="date"
							value={data.query?.since}
							class="mt-2 w-full rounded-xl border border-line bg-panel px-2 py-2 text-xs text-slate-200"
						/></label
					><label class="text-xs font-semibold text-slate-300" for="until"
						>Until<input
							id="until"
							name="until"
							type="date"
							value={data.query?.until}
							class="mt-2 w-full rounded-xl border border-line bg-panel px-2 py-2 text-xs text-slate-200"
						/></label
					>
				</div>
				<button
					class="mt-5 w-full rounded-xl bg-mint px-4 py-3 text-sm font-extrabold text-ink hover:bg-lime"
					>Apply filters</button
				>
			</form>
			<div class="rounded-2xl border border-lime/15 bg-lime/[0.045] p-5">
				<p class="eyebrow !text-lime">Share your experience</p>
				<p class="mt-2 text-sm leading-6 text-slate-300">
					Native TuxGG reports are not open yet. Report publishing requires verified Steam account
					linking.
				</p>
				<a class="mt-3 inline-flex text-sm font-bold text-lime hover:text-mint" href="/about"
					>How contributions work →</a
				>
			</div>
			{#if data.reportData?.launchOptions.length}<div class="surface rounded-2xl p-5">
					<h2 class="font-bold text-white">Common launch options</h2>
					<div class="mt-3 space-y-3">
						{#each data.reportData.launchOptions as option}<div>
								<code class="block rounded-lg bg-black/20 px-3 py-2 text-xs break-all text-mint"
									>{option.value}</code
								>
								<p class="mt-1 text-[0.68rem] text-muted">{option.count} reports</p>
							</div>{/each}
					</div>
				</div>{/if}
			{#if data.reportData?.hardware.length}<div class="surface rounded-2xl p-5">
					<h2 class="font-bold text-white">Common setups</h2>
					<div class="mt-3 space-y-3">
						{#each data.reportData.hardware as setup}<div
								class="border-t border-white/[0.07] pt-3 first:border-0 first:pt-0"
							>
								<p class="text-xs font-semibold text-slate-200">
									{[setup.gpu, setup.cpu].filter(Boolean).join(' · ') || 'Hardware not specified'}
								</p>
								{#if setup.distribution}<p class="mt-1 text-xs text-muted">
										{setup.distribution}
									</p>{/if}
								<p class="mt-1 text-[0.68rem] text-slate-500">{setup.total} reports</p>
							</div>{/each}
					</div>
				</div>{/if}
		</aside>
	</section>
	<section class="container-shell mt-8 mb-20">
		<p class="text-xs leading-5 text-slate-500">
			TuxGG’s compatibility tier is a community-data summary, not a guarantee of performance.
			Original ProtonDB data is attributed to its source and remains distinguishable from future
			native TuxGG reports.
		</p>
	</section>
{/if}
