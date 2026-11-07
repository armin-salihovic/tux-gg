<script lang="ts">
	import type { PageData } from './$types';
	import GameCard from '#lib/components/GameCard.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	let { data }: { data: PageData } = $props();
	function pageHref(page: number) {
		const params = new URLSearchParams();
		if (data.q) params.set('q', data.q);
		if (data.sort !== 'title') params.set('sort', data.sort);
		if (page > 1) params.set('page', String(page));
		return `/games${params.size ? `?${params}` : ''}`;
	}
</script>

<svelte:head>
	<title>{data.q ? `Search ${data.q} | TuxGG` : 'Browse Steam games | TuxGG'}</title>
	<meta
		name="description"
		content="Browse Steam games and read Linux and Steam Deck compatibility reports from TuxGG players."
	/>
	<link rel="canonical" href={data.canonical} />
	<meta property="og:type" content="website" />
	<meta
		property="og:title"
		content={data.q ? `Search ${data.q} | TuxGG` : 'Browse Steam games | TuxGG'}
	/>
	<meta
		property="og:description"
		content="Browse Steam games and read Linux and Steam Deck compatibility reports from TuxGG players."
	/>
	<meta property="og:url" content={data.canonical} />
	<meta name="twitter:card" content="summary" />
	<meta
		name="twitter:title"
		content={data.q ? `Search ${data.q} | TuxGG` : 'Browse Linux-compatible games | TuxGG'}
	/>
	<meta
		name="twitter:description"
		content="Browse Steam games and read Linux and Steam Deck compatibility reports from TuxGG players."
	/>
	{#if data.filtered}<meta name="robots" content="noindex,follow" />{/if}
</svelte:head>

<section class="container-shell py-12 sm:py-16">
	<p class="eyebrow">Steam catalog</p>
	<div class="mt-3 flex flex-wrap items-end justify-between gap-4">
		<div>
			<h1 class="text-3xl font-black tracking-tight text-white sm:text-4xl">Find your next game</h1>
			<p class="mt-2 text-sm text-muted">
				Search Steam titles and compare player-submitted Linux setups.
			</p>
		</div>
		<div class="text-sm text-muted">{data.total.toLocaleString()} games</div>
	</div>
	<form
		class="surface mt-8 grid gap-3 rounded-2xl p-4 sm:grid-cols-[minmax(12rem,1fr)_12rem_auto]"
		method="GET"
	>
		<label class="sr-only" for="q">Game title or Steam app ID</label>
		<input
			id="q"
			name="q"
			maxlength="100"
			value={data.q}
			placeholder="Game title or Steam app ID"
			class="min-w-0 rounded-xl border border-line bg-black/20 px-4 py-3 text-sm text-white placeholder:text-slate-500"
		/>
		<label class="sr-only" for="sort">Sort games</label>
		<select
			id="sort"
			name="sort"
			class="rounded-xl border border-line bg-panel px-4 py-3 text-sm text-slate-200"
			><option value="title" selected={data.sort === 'title'}>Title</option><option
				value="reports"
				selected={data.sort === 'reports'}>Most community reports</option
			><option value="recent" selected={data.sort === 'recent'}>Recently reported</option><option
				value="tier"
				selected={data.sort === 'tier'}>Compatibility tier</option
			></select
		>
		<button
			class="rounded-xl bg-mint px-5 py-3 text-sm font-extrabold text-ink transition hover:bg-lime"
			>Search</button
		>
	</form>
	{#if !data.available}
		<div
			class="mt-6 rounded-2xl border border-amber-200/20 bg-amber-200/[0.05] p-5 text-sm leading-6 text-amber-100"
		>
			The game catalog is temporarily unavailable. Please try again later.
		</div>
	{:else if data.games.length}
		<div class="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
			{#each data.games as game (game.appId)}<GameCard {game} />{/each}
		</div>
		<nav class="mt-9 flex items-center justify-between gap-4" aria-label="Catalog pages">
			{#if data.page > 1}<a
					class="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-slate-200 hover:border-mint/40"
					href={pageHref(data.page - 1)}>← Previous</a
				>{:else}<span></span>{/if}
			<span class="text-xs text-muted">Page {data.page} of {data.pageCount}</span>
			{#if data.page < data.pageCount}<a
					class="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-slate-200 hover:border-mint/40"
					href={pageHref(data.page + 1)}>Next →</a
				>{:else}<span></span>{/if}
		</nav>
	{:else}
		<div class="mt-8">
			<EmptyState
				title="No games found"
				description="Try another Steam title or AppID."
				actionHref="/games"
				actionLabel="Clear filters"
			/>
		</div>
	{/if}
</section>
