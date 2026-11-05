<script lang="ts">
	import GameCard from '#lib/components/GameCard.svelte';
	import GameSearch from '#lib/components/GameSearch.svelte';
	import CompatibilityBadge from '#lib/components/CompatibilityBadge.svelte';
	import GameArtwork from '#lib/components/GameArtwork.svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
	const tiers = [
		{ key: 'platinum', label: 'Platinum', copy: 'Strong out-of-box results' },
		{ key: 'gold', label: 'Gold', copy: 'Works with small adjustments' },
		{ key: 'silver', label: 'Silver', copy: 'Playable with some tuning' },
		{ key: 'bronze', label: 'Bronze', copy: 'Runs, with notable issues' },
		{ key: 'borked', label: 'Borked', copy: 'Current reports show failures' },
		{ key: 'unknown', label: 'Unknown', copy: 'More recent reports needed' }
	];
</script>

<svelte:head>
	<title>Linux Game Compatibility & Reports | TuxGG</title>
	<meta
		name="description"
		content="Find Linux and Steam Deck game compatibility, compare Proton versions, and read real community reports on TuxGG."
	/>
	<link rel="canonical" href={data.canonical} />
	<meta property="og:type" content="website" />
	<meta property="og:title" content="Linux Game Compatibility & Reports | TuxGG" />
	<meta
		property="og:description"
		content="Search Linux and Steam Deck compatibility reports, Proton versions, hardware, and workarounds."
	/>
	<meta property="og:url" content={data.canonical} />
	<meta property="og:image" content={data.ogImage} />
	<meta name="twitter:title" content="Linux Game Compatibility & Reports | TuxGG" />
	<meta
		name="twitter:description"
		content="Search Linux and Steam Deck compatibility reports, Proton versions, hardware, and workarounds."
	/>
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:image" content={data.ogImage} />
</svelte:head>

<section class="container-shell pt-12 sm:pt-20">
	<div
		class="relative overflow-hidden rounded-[2rem] border border-mint/10 bg-[linear-gradient(125deg,rgba(20,49,51,.92),rgba(13,25,31,.96)_55%,rgba(14,31,25,.96))] px-6 py-10 sm:px-12 sm:py-16"
	>
		<div
			class="absolute -top-28 -right-20 size-[22rem] rounded-full border border-mint/[0.08]"
		></div>
		<div
			class="absolute -top-10 -right-2 size-[17rem] rounded-full border border-mint/[0.08]"
		></div>
		<div class="relative max-w-3xl">
			<p class="eyebrow">The Linux gaming compatibility guide</p>
			<h1
				class="mt-5 max-w-3xl text-4xl leading-[1.04] font-black tracking-[-0.045em] text-white sm:text-6xl"
			>
				Know before you <span class="text-mint">launch.</span>
			</h1>
			<p class="mt-5 max-w-2xl leading-7 text-base text-slate-300 sm:text-lg">
				Search real Linux and Steam Deck reports. See what works, which Proton builds people used,
				and where the rough edges are.
			</p>
			<div class="mt-8 max-w-2xl"><GameSearch /></div>
			<div class="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-400">
				<span>Search by title</span><span class="text-slate-700">•</span><span
					>Paste a Steam app ID</span
				><span class="text-slate-700">•</span><a
					class="text-mint underline decoration-mint/30 hover:decoration-mint"
					href="/games">Browse the catalog</a
				>
			</div>
		</div>
	</div>
</section>

<section class="container-shell mt-10 grid gap-3 sm:grid-cols-3">
	<div class="surface flex items-center gap-4 rounded-2xl p-5">
		<span class="grid size-11 place-items-center rounded-xl bg-mint/10 text-lg text-mint">◎</span>
		<div>
			<div class="text-2xl font-extrabold text-white">{data.totalGames.toLocaleString()}</div>
			<div class="text-xs text-muted">games indexed</div>
		</div>
	</div>
	<div class="surface flex items-center gap-4 rounded-2xl p-5">
		<span class="grid size-11 place-items-center rounded-xl bg-lime/10 text-lg text-lime">▤</span>
		<div>
			<div class="text-2xl font-extrabold text-white">{data.totalReports.toLocaleString()}</div>
			<div class="text-xs text-muted">imported reports</div>
		</div>
	</div>
	<div class="surface flex items-center gap-4 rounded-2xl p-5">
		<span class="grid size-11 place-items-center rounded-xl bg-sky-300/10 text-lg text-sky-200"
			>⌁</span
		>
		<div>
			<div class="text-sm font-bold text-white">Desktop Linux + Steam Deck</div>
			<div class="text-xs text-muted">One searchable compatibility catalog</div>
		</div>
	</div>
</section>

{#if !data.available}
	<section class="container-shell mt-8">
		<div
			class="rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] px-5 py-4 text-sm leading-6 text-amber-100"
		>
			The catalog database is not available yet. Configure PostgreSQL, apply the migrations, and
			import the ProtonDB snapshots to show live game data.
		</div>
	</section>
{/if}

<section class="container-shell mt-16">
	<div class="flex flex-wrap items-end justify-between gap-4">
		<div>
			<p class="eyebrow">A quick read on compatibility</p>
			<h2 class="mt-2 text-2xl font-extrabold tracking-tight text-white">
				Clear tiers, with context
			</h2>
		</div>
		<a class="text-sm font-semibold text-mint hover:text-lime" href="/methodology"
			>How TuxGG scores games <span aria-hidden="true">→</span></a
		>
	</div>
	<div class="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
		{#each tiers as tier}
			<a
				class="surface flex items-center justify-between gap-4 rounded-2xl p-4 no-underline transition hover:border-white/20"
				href={`/games?tier=${tier.key}`}
			>
				<div>
					<div class="font-bold text-white">{tier.label}</div>
					<p class="mt-1 text-xs text-muted">{tier.copy}</p>
				</div>
				<CompatibilityBadge tier={tier.key} />
			</a>
		{/each}
	</div>
</section>

<section class="container-shell mt-16">
	<div class="flex flex-wrap items-end justify-between gap-4">
		<div>
			<p class="eyebrow">From the real report corpus</p>
			<h2 class="mt-2 text-2xl font-extrabold tracking-tight text-white">Popular games</h2>
		</div>
		<a class="text-sm font-semibold text-mint hover:text-lime" href="/games?sort=reports"
			>View all games <span aria-hidden="true">→</span></a
		>
	</div>
	{#if data.popular.length}
		<div class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
			{#each data.popular as game (game.appId)}<GameCard {game} />{/each}
		</div>
	{:else if data.available}
		<div
			class="mt-6 rounded-2xl border border-dashed border-line px-6 py-10 text-center text-sm text-muted"
		>
			No imported game reports yet. The catalog will fill in after the first import.
		</div>
	{/if}
</section>

<section class="container-shell mt-16 grid gap-8 lg:grid-cols-[1.1fr_.9fr]">
	<div class="surface rounded-3xl p-6 sm:p-8">
		<p class="eyebrow">Built for useful details</p>
		<h2 class="mt-3 text-2xl font-extrabold tracking-tight text-white">
			Compatibility is more than a badge.
		</h2>
		<p class="mt-3 max-w-xl text-sm leading-7 text-muted">
			Compare the Linux distribution, GPU, graphics driver, Proton variant, launch options, and
			known issues reported by players. TuxGG keeps original ProtonDB verdicts visible beside its
			own recency-weighted summary.
		</p>
		<a
			class="mt-6 inline-flex items-center gap-2 text-sm font-bold text-mint hover:text-lime"
			href="/data-sources">Read about the data <span aria-hidden="true">→</span></a
		>
	</div>
	<div class="rounded-3xl border border-lime/15 bg-lime/[0.045] p-6 sm:p-8">
		<p class="eyebrow !text-lime">Community reports</p>
		<h2 class="mt-3 text-2xl font-extrabold tracking-tight text-white">Your setup matters.</h2>
		<p class="mt-3 text-sm leading-7 text-slate-300">
			Steam sign-in creates your TuxGG account. Native report publishing stays disabled because
			Steam identity alone does not verify ownership of a particular game.
		</p>
		<a
			class="mt-6 inline-flex items-center gap-2 text-sm font-bold text-lime hover:text-mint"
			href="/about">What we’re building <span aria-hidden="true">→</span></a
		>
	</div>
</section>

<section class="container-shell mt-16 mb-20">
	<div class="flex flex-wrap items-end justify-between gap-4">
		<div>
			<p class="eyebrow">Fresh activity</p>
			<h2 class="mt-2 text-2xl font-extrabold tracking-tight text-white">Recently reported</h2>
		</div>
	</div>
	{#if data.recent.length}
		<div class="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{#each data.recent as game (game.appId)}
				<a
					class="surface flex items-center gap-4 rounded-2xl p-4 no-underline transition hover:border-mint/30"
					href={`/games/${game.appId}/${game.slug}`}
				>
					<GameArtwork
						appId={game.appId}
						variant="thumbnail"
						aspect="card"
						preferredUrl={game.artworkUrl}
						alt=""
						class="w-24 shrink-0 rounded-xl"
					/>
					<div class="min-w-0">
						<div class="truncate font-bold text-white">
							{game.title ?? `Steam app ${game.appId}`}
						</div>
						<div class="mt-1 text-xs text-muted">
							{game.reportCount.toLocaleString()} imported reports
						</div>
					</div>
					<span class="shrink-0"><CompatibilityBadge tier={game.tier} /></span>
				</a>
			{/each}
		</div>
	{:else if data.available}
		<p class="mt-6 text-sm text-muted">
			Recent game activity will appear here after reports are imported.
		</p>
	{/if}
</section>
