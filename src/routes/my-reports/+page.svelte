<script lang="ts">
	import type { PageData } from './$types';
	import GameArtwork from '#lib/components/GameArtwork.svelte';
	let { data }: { data: PageData } = $props();
	const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });
	const statusLabels: Record<string, string> = {
		pending: 'Pending review',
		published: 'Published',
		hidden: 'Hidden',
		removed: 'Removed'
	};
	const pageHref = (page: number) => (page > 1 ? `/my-reports?page=${page}` : '/my-reports');
</script>

<svelte:head>
	<title>My Reports | VapourDB</title>
	<meta name="robots" content="noindex,follow" />
</svelte:head>

<section class="container-shell max-w-5xl py-10 sm:py-14">
	<div class="flex flex-wrap items-end justify-between gap-4">
		<div>
			<p class="eyebrow">Your contributions</p>
			<h1 class="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">My Reports</h1>
		</div>
		<a
			class="rounded-xl border border-mint/25 bg-mint/10 px-4 py-2.5 text-sm font-bold text-mint hover:bg-mint/15"
			href="/games">Browse games</a
		>
	</div>

	{#if data.submitted}
		<p
			role="status"
			class="mt-6 rounded-xl border border-mint/20 bg-mint/[0.06] p-4 text-sm text-mint"
		>
			Your report was submitted for review. It will appear publicly after approval.
		</p>
	{/if}

	{#if data.reportData.reports.length === 0}
		<div class="surface mt-7 rounded-2xl p-7 sm:p-10">
			<h2 class="text-lg font-bold text-white">
				You haven't written any compatibility reports yet.
			</h2>
			<p class="mt-2 text-sm text-muted">Share how your games run on Linux or Steam Deck.</p>
			<a
				class="mt-5 inline-flex rounded-xl bg-mint px-4 py-2.5 text-sm font-extrabold text-ink hover:bg-lime"
				href="/games">Browse games</a
			>
		</div>
	{:else}
		<div class="mt-7 grid gap-4">
			{#each data.reportData.reports as report (report.id)}
				<article
					class="surface grid gap-4 rounded-2xl p-4 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:items-center sm:p-5"
				>
					<a
						href={`/games/${report.appId}/${report.slug}`}
						aria-label={`Open ${report.title ?? `Steam app ${report.appId}`}`}
					>
						<GameArtwork
							appId={report.appId}
							variant="thumbnail"
							aspect="card"
							preferredUrl={report.artworkUrl}
							alt=""
							class="w-full rounded-xl"
						/>
					</a>
					<div class="min-w-0">
						<a
							class="text-lg font-bold text-white hover:text-mint"
							href={`/games/${report.appId}/${report.slug}`}
							>{report.title ?? `Steam app ${report.appId}`}</a
						>
						<p class="mt-1 text-sm text-slate-300">
							{report.verdict === 'yes' ? 'Yes — works' : 'No — does not work'} · {report.platform ===
							'steam_deck'
								? 'Steam Deck'
								: 'Linux desktop'}
						</p>
						<p class="mt-1 text-xs text-muted">Submitted {dateFormat.format(report.createdAt)}</p>
						{#if report.deviceNameSnapshot}<p class="mt-1 text-xs text-muted">
								Device: {report.deviceNameSnapshot}
							</p>{/if}
					</div>
					<span
						class="w-fit rounded-full border px-3 py-1.5 text-xs font-semibold {report.moderationState ===
						'published'
							? 'border-mint/25 bg-mint/10 text-mint'
							: 'border-white/10 bg-white/[0.04] text-slate-300'}"
						>{statusLabels[report.moderationState] ?? 'Pending review'}</span
					>
				</article>
			{/each}
		</div>
		{#if data.reportData.pageCount > 1}
			<nav class="mt-7 flex items-center justify-between gap-3" aria-label="My report pages">
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
		{/if}
	{/if}
</section>
