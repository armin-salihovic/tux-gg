<script lang="ts">
	import type { PageData } from './$types';
	import NativeReportCard from '#lib/components/NativeReportCard.svelte';
	let { data }: { data: PageData } = $props();
	const joined = $derived(
		new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(data.profile.createdAt)
	);
	function pageHref(page: number) {
		return page > 1
			? `/users/${data.profile.username}?page=${page}`
			: `/users/${data.profile.username}`;
	}
</script>

<svelte:head
	><title>{data.profile.name} (@{data.profile.username}) | VapourDB</title><meta
		name="description"
		content={`VapourDB community profile for ${data.profile.name}.`}
	/><link rel="canonical" href={data.canonical} /><meta
		property="og:title"
		content={`${data.profile.name} (@${data.profile.username}) | VapourDB`}
	/><meta property="og:url" content={data.canonical} /><meta
		name="twitter:card"
		content="summary"
	/><meta
		name="twitter:title"
		content={`${data.profile.name} | VapourDB`}
	/>{#if data.profile.contributionCount === 0}<meta
			name="robots"
			content="noindex,follow"
		/>{/if}</svelte:head
>

<section class="container-shell max-w-3xl py-14">
	<div class="surface flex flex-col items-center rounded-3xl p-8 text-center sm:p-12">
		{#if data.profile.image}<img
				class="size-24 rounded-full border border-white/10 object-cover"
				src={data.profile.image}
				alt=""
				referrerpolicy="no-referrer"
			/>{:else}<div
				class="grid size-24 place-items-center rounded-full bg-mint/10 text-3xl font-black text-mint"
			>
				{data.profile.name.slice(0, 1).toUpperCase()}
			</div>{/if}
		<h1 class="mt-5 text-3xl font-black text-white">{data.profile.name}</h1>
		<p class="mt-1 text-sm text-muted">@{data.profile.username}</p>
		<div class="mt-7 grid w-full max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4">
			<div class="rounded-xl border border-white/[0.07] bg-black/10 p-4">
				<div class="text-2xl font-extrabold text-mint">{data.profile.contributionCount}</div>
				<div class="mt-1 text-xs text-muted">public VapourDB reports</div>
			</div>
			<div class="rounded-xl border border-white/[0.07] bg-black/10 p-4">
				<div class="text-2xl font-extrabold text-mint">{data.profile.worksCount}</div>
				<div class="mt-1 text-xs text-muted">works</div>
			</div>
			<div class="rounded-xl border border-white/[0.07] bg-black/10 p-4">
				<div class="text-2xl font-extrabold text-rose-200">{data.profile.doesNotWorkCount}</div>
				<div class="mt-1 text-xs text-muted">doesn't work</div>
			</div>
			<div class="rounded-xl border border-white/[0.07] bg-black/10 p-4">
				<div class="text-sm font-bold text-white">{joined}</div>
				<div class="mt-1 text-xs text-muted">member since</div>
			</div>
		</div>
		<p class="mt-6 text-xs text-slate-500">
			Only public profile information and report hardware snapshots are shown. Account details
			remain private.
		</p>
	</div>

	<section class="mt-10" aria-labelledby="community-reports-heading">
		<div class="flex flex-wrap items-end justify-between gap-3">
			<div>
				<p class="eyebrow">VapourDB Community</p>
				<h2 id="community-reports-heading" class="mt-2 text-2xl font-extrabold text-white">
					Community Reports
				</h2>
			</div>
			{#if data.reportData.total > 0}
				<p class="text-xs text-muted">
					{data.reportData.total.toLocaleString()} public {data.reportData.total === 1
						? 'report'
						: 'reports'}
				</p>
			{/if}
		</div>
		{#if data.reportData.reports.length > 0}
			<div class="mt-5 grid gap-4">
				{#each data.reportData.reports as report (report.id)}
					<NativeReportCard {report} showAuthor={false} />
				{/each}
			</div>
			{#if data.reportData.pageCount > 1}
				<nav
					class="mt-5 flex items-center justify-between gap-3"
					aria-label="Community report pages"
				>
					{#if data.reportData.page > 1}<a
							class="rounded-xl border border-line px-4 py-2 text-sm text-white hover:border-mint/40"
							href={pageHref(data.reportData.page - 1)}
							rel="prev">← Previous</a
						>{:else}<span></span>{/if}
					<span class="text-xs text-muted"
						>Page {data.reportData.page} of {data.reportData.pageCount}</span
					>
					{#if data.reportData.page < data.reportData.pageCount}<a
							class="rounded-xl border border-line px-4 py-2 text-sm text-white hover:border-mint/40"
							href={pageHref(data.reportData.page + 1)}
							rel="next">Next →</a
						>{:else}<span></span>{/if}
				</nav>
			{/if}
		{:else}
			<div class="surface mt-5 rounded-2xl p-6 sm:p-8">
				<h3 class="text-lg font-bold text-white">No community reports yet</h3>
				<p class="mt-2 text-sm leading-6 text-muted">
					{data.profile.name} hasn't shared any Linux or Steam Deck compatibility reports yet.
				</p>
				<a class="mt-4 inline-flex text-sm font-semibold text-mint hover:text-lime" href="/games"
					>Explore games →</a
				>
			</div>
		{/if}
	</section>
</section>
