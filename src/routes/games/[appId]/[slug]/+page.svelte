<script lang="ts">
	import { formatGpuName } from '#lib/gpu-format.js';
	import type { PageData } from './$types';
	import GameArtwork from '#lib/components/GameArtwork.svelte';
	import CompatibilityBadge from '#lib/components/CompatibilityBadge.svelte';
	import { isIndexableGame } from '#lib/seo-constants.js';
	let { data }: { data: PageData } = $props();
	const gamePath = $derived(
		data.game ? `/games/${data.game.appId}/${data.game.slug}` : `/games/${data.appId}`
	);
	function pageHref(page: number) {
		const p = new URLSearchParams();
		const keys = {
			gpu: 'gpuVendor',
			distribution: 'distribution',
			proton: 'proton',
			verdict: 'verdict',
			since: 'since',
			until: 'until'
		} as const;
		for (const [parameter, key] of Object.entries(keys)) {
			const value = data.query?.[key];
			if (typeof value === 'string' && value) p.set(parameter, value);
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
					sameAs: `https://store.steampowered.com/app/${data.game.appId}/`
				}).replace(/</g, '\\u003c')
			: ''
	);
	const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });
</script>

<svelte:head>
	<title
		>{data.available && data.game
			? `${data.game.title} Linux Compatibility | VapourDB`
			: `Game ${data.appId} | VapourDB`}</title
	>
	<meta
		name="description"
		content={data.available && data.game
			? data.description
			: 'Game compatibility details are temporarily unavailable.'}
	/>
	<link rel="canonical" href={data.canonical} />
	{#if data.filtered || !data.available || !data.game || !isIndexableGame(data.game.titleAvailable ? data.game.title : null, data.game.metadata)}
		<meta name="robots" content="noindex,follow" />
	{/if}
	{#if data.available && data.game}
		<meta property="og:type" content="website" />
		<meta property="og:title" content={`${data.game.title} Linux Compatibility | VapourDB`} />
		<meta property="og:description" content={data.description} />
		<meta property="og:url" content={data.canonical} />
		<meta property="og:image" content={data.ogImage} />
		<meta property="og:image:type" content="image/png" />
		<meta property="og:image:width" content="1200" />
		<meta property="og:image:height" content="630" />
		<meta property="og:image:alt" content="VapourDB Linux and Steam Deck game compatibility" />
		<meta name="twitter:title" content={`${data.game.title} Linux Compatibility | VapourDB`} />
		<meta name="twitter:description" content={data.description} />
		<meta name="twitter:card" content="summary_large_image" />
		<meta name="twitter:image" content={data.ogImage} />
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
	{@const metadata = data.game.metadata}
	{@const steam = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
		? (metadata as Record<string, unknown>).steam as Record<string, unknown> | undefined
		: undefined}
	<section class="container-shell pt-8 sm:pt-12">
		<nav class="text-xs text-muted" aria-label="Breadcrumb">
			<a class="hover:text-mint" href="/games">Games</a><span class="px-2 text-slate-600">/</span
			><span>{data.game.title}</span>
		</nav>
		<div class="surface relative mt-5 overflow-hidden rounded-3xl">
			<GameArtwork
				appId={data.game.appId}
				variant="header"
				aspect="header"
				preferredUrl={data.game.headerImageUrl}
				alt=""
				loading="eager"
				fetchPriority="high"
				class="w-full"
			/>
			<div class="grid gap-7 p-6 sm:grid-cols-[1fr_auto] sm:items-end sm:p-10">
				<div>
					<p class="eyebrow">Steam app {data.game.appId} · Linux compatibility</p>
					<h1 class="mt-3 max-w-3xl text-3xl font-black tracking-tight text-white sm:text-5xl">
						{data.game.title}
					</h1>
					<p class="mt-5 text-sm text-slate-300">
						{data.game.reportCount.toLocaleString()} VapourDB community {data.game.reportCount === 1 ? 'report' : 'reports'}
						<span class="px-1.5 text-slate-600">·</span>
						Works: <strong class="text-mint">{data.game.yesCount}</strong>
						<span class="px-1.5 text-slate-600">·</span>
						Does not work: <strong class="text-rose-200">{data.game.noCount}</strong>
					</p>
					<div class="mt-3 flex flex-wrap items-center gap-3">
						<CompatibilityBadge tier={data.game.tier} />
						{#if data.game.weightedScore !== null}
							<span class="text-xs text-muted">
								{Math.round(data.game.weightedScore * 100)}% positive · effective sample {data.game.effectiveSampleSize.toFixed(1)}
							</span>
						{:else}
							<span class="text-xs text-muted">Not enough community reports to rate</span>
						{/if}
					</div>
					{#if steam?.shortDescription}<p class="mt-4 max-w-2xl text-sm leading-6 text-slate-300">{steam.shortDescription}</p>{/if}
					{#if data.game.reportCount && data.game.lastReportAt}<p class="mt-2 text-xs text-muted">Latest report: {dateFormat.format(data.game.lastReportAt)}</p>{/if}
				</div>
				<a
					class="rounded-xl border border-white/15 bg-black/20 px-4 py-2.5 text-sm font-semibold text-white hover:border-mint/40"
					href={`https://store.steampowered.com/app/${data.game.appId}/`}
					target="_blank"
					rel="noopener noreferrer">Steam page ↗</a
				>
			</div>
		</div>
	</section>

	<section class="container-shell mt-8">
		<div class="rounded-2xl border border-lime/15 bg-lime/[0.045] p-5 sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-6">
			<div>
				<p class="eyebrow !text-lime">Share your experience</p>
				<h2 class="mt-1 text-lg font-bold text-white">Played this game on Linux or Steam Deck?</h2>
				<p class="mt-1 max-w-2xl text-sm leading-6 text-slate-300">Help other players by sharing how it runs. Reports appear publicly after submission and may be moderated later.</p>
			</div>
			<a class="mt-4 inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-mint px-5 py-3 text-sm font-extrabold text-ink hover:bg-lime sm:mt-0" href={`${gamePath}/report/new`}>Write a Report</a>
		</div>
	</section>

	<section class="container-shell mt-8 mb-20 grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
		<div>
			<div class="flex flex-wrap items-end justify-between gap-3">
				<div>
					<p class="eyebrow">VapourDB Community Reports</p>
					<h2 class="mt-2 text-2xl font-extrabold text-white">Player-submitted reports</h2>
				</div>
				{#if data.nativeReportData}<span class="text-xs text-muted">{data.nativeReportData.total.toLocaleString()} reports</span>{/if}
			</div>
			{#if !data.nativeReportData}
				<div class="mt-5 rounded-2xl border border-amber-200/20 bg-amber-200/[0.05] p-5 text-sm text-amber-100">VapourDB community reports are temporarily unavailable.</div>
			{:else if data.nativeReportData.reports.length}
				<div class="mt-5 grid gap-4">
					{#each data.nativeReportData.reports as report (report.id)}
						<article class="surface rounded-2xl p-5 sm:p-6">
							<div class="flex flex-wrap items-start justify-between gap-3">
								<div>
									<a class="font-bold text-white hover:text-mint" href={`/users/${report.authorUsername}`}>@{report.authorUsername}</a>
									<p class="mt-1 text-sm text-slate-300">{report.verdict === 'yes' ? 'Yes — works' : 'No — does not work'} · {report.platform === 'steam_deck' ? 'Steam Deck' : report.platform === 'linux_desktop' ? 'Linux desktop' : 'Platform not specified'}</p>
								</div>
								<time class="text-xs text-muted" datetime={report.createdAt.toISOString()}>{dateFormat.format(report.createdAt)}</time>
							</div>
							{#if report.deviceNameSnapshot}<h3 class="mt-4 border-t border-white/[0.06] pt-4 text-sm font-bold text-white">{report.deviceNameSnapshot}</h3>{/if}
							{#if report.protonVersion || report.protonVariant || report.customProtonVersion || report.distribution || report.kernel || report.cpu || report.gpu || report.gpuVendor || report.graphicsDriver || report.gpuDriverDetail || report.ram || report.launchOptions}
								<dl class="mt-4 grid gap-x-5 gap-y-2 border-t border-white/[0.06] pt-4 sm:grid-cols-2">
									{#if report.protonVersion || report.protonVariant || report.customProtonVersion}<div><dt class="text-[0.68rem] font-semibold uppercase tracking-wide text-slate-500">Proton</dt><dd class="mt-0.5 text-sm text-slate-200">{[report.protonVariant, report.protonVersion, report.customProtonVersion].filter(Boolean).join(' · ')}</dd></div>{/if}
									{#if report.distribution}<div><dt class="text-[0.68rem] font-semibold uppercase tracking-wide text-slate-500">Distribution</dt><dd class="mt-0.5 text-sm text-slate-200">{report.distribution}</dd></div>{/if}
									{#if report.gpu || report.gpuVendor || report.graphicsDriver || report.gpuDriverDetail}<div><dt class="text-[0.68rem] font-semibold uppercase tracking-wide text-slate-500">Graphics</dt><dd class="mt-0.5 text-sm text-slate-200">{[formatGpuName(report.gpuVendor, report.gpu), report.graphicsDriver, report.gpuDriverDetail].filter(Boolean).join(' · ')}</dd></div>{/if}
									{#if report.cpu || report.kernel || report.ram}<div><dt class="text-[0.68rem] font-semibold uppercase tracking-wide text-slate-500">System</dt><dd class="mt-0.5 text-sm text-slate-200">{[report.cpu, report.kernel ? `Kernel ${report.kernel}` : null, report.ram].filter(Boolean).join(' · ')}</dd></div>{/if}
									{#if report.launchOptions}<div class="sm:col-span-2"><dt class="text-[0.68rem] font-semibold uppercase tracking-wide text-slate-500">Launch options</dt><dd class="mt-0.5 break-words font-mono text-xs text-mint">{report.launchOptions}</dd></div>{/if}
								</dl>
							{/if}
							{#if report.content}<p class="mt-4 whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">{report.content}</p>{/if}
							{#if report.performanceNotes}<div class="mt-4 rounded-xl bg-white/[0.035] p-3"><p class="text-xs font-semibold text-slate-400">Performance notes</p><p class="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">{report.performanceNotes}</p></div>{/if}
							{#if report.knownIssues}<div class="mt-3 rounded-xl bg-rose-200/[0.04] p-3"><p class="text-xs font-semibold text-rose-100/80">Known issues</p><p class="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">{report.knownIssues}</p></div>{/if}
						</article>
					{/each}
				</div>
				{#if data.nativeReportData.pageCount > 1}
					<nav class="mt-5 flex items-center justify-between gap-3" aria-label="VapourDB community report pages">
						{#if data.nativeReportData.page > 1}<a class="rounded-xl border border-line px-4 py-2 text-sm text-white hover:border-mint/40" href={pageHref(data.nativeReportData.page - 1)}>← Previous</a>{:else}<span></span>{/if}
						<span class="text-xs text-muted">Page {data.nativeReportData.page} of {data.nativeReportData.pageCount}</span>
						{#if data.nativeReportData.page < data.nativeReportData.pageCount}<a class="rounded-xl border border-line px-4 py-2 text-sm text-white hover:border-mint/40" href={pageHref(data.nativeReportData.page + 1)}>Next →</a>{:else}<span></span>{/if}
					</nav>
				{/if}
			{:else}
				<p class="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 text-sm text-muted">No VapourDB community reports match these filters yet.</p>
			{/if}
		</div>
		<aside>
			<form method="GET" class="surface rounded-2xl p-5">
				<h2 class="font-bold text-white">Filter reports</h2>
				<label class="mt-4 block text-xs font-semibold text-slate-300" for="gpu">GPU vendor</label>
				<select id="gpu" name="gpu" class="mt-2 w-full rounded-xl border border-line bg-panel px-3 py-2.5 text-sm text-slate-200">
					<option value="">Any vendor</option>
					{#each data.filters.gpuVendors as value}<option {value} selected={data.query?.gpuVendor === value}>{value}</option>{/each}
				</select>
				<label class="mt-4 block text-xs font-semibold text-slate-300" for="distribution">Distribution</label>
				<select id="distribution" name="distribution" class="mt-2 w-full rounded-xl border border-line bg-panel px-3 py-2.5 text-sm text-slate-200">
					<option value="">Any distribution</option>
					{#each data.filters.distributions as value}<option {value} selected={data.query?.distribution === value}>{value}</option>{/each}
				</select>
				<label class="mt-4 block text-xs font-semibold text-slate-300" for="proton">Proton version or variant</label>
				<select id="proton" name="proton" class="mt-2 w-full rounded-xl border border-line bg-panel px-3 py-2.5 text-sm text-slate-200">
					<option value="">Any Proton build</option>
					{#each data.filters.proton as option (option.value)}<option value={option.value} selected={data.query?.proton === option.value}>{option.label}</option>{/each}
				</select>
				<label class="mt-4 block text-xs font-semibold text-slate-300" for="verdict">Community verdict</label>
				<select id="verdict" name="verdict" class="mt-2 w-full rounded-xl border border-line bg-panel px-3 py-2.5 text-sm text-slate-200">
					<option value="">Any verdict</option>
					<option value="yes" selected={data.query?.verdict === 'yes'}>Works</option>
					<option value="no" selected={data.query?.verdict === 'no'}>Does not work</option>
				</select>
				<div class="mt-4 grid grid-cols-2 gap-2">
					<label class="text-xs font-semibold text-slate-300" for="since">Since<input id="since" name="since" type="date" value={data.query?.since} class="mt-2 w-full rounded-xl border border-line bg-panel px-2 py-2 text-xs text-slate-200" /></label>
					<label class="text-xs font-semibold text-slate-300" for="until">Until<input id="until" name="until" type="date" value={data.query?.until} class="mt-2 w-full rounded-xl border border-line bg-panel px-2 py-2 text-xs text-slate-200" /></label>
				</div>
				<button class="mt-5 w-full rounded-xl bg-mint px-4 py-3 text-sm font-extrabold text-ink hover:bg-lime">Apply filters</button>
			</form>
		</aside>
	</section>
{/if}
