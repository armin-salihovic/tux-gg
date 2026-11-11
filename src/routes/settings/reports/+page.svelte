<script lang="ts">
	import type { ActionData, PageData } from './$types';
	import NativeReportCard from '#lib/components/NativeReportCard.svelte';
	let { data, form }: { data: PageData; form: ActionData } = $props();
	const filterOptions = [
		{ value: 'pending', label: 'Unreviewed' },
		{ value: 'published', label: 'Published' },
		{ value: 'hidden', label: 'Hidden' },
		{ value: 'removed', label: 'Removed' },
		{ value: 'all', label: 'All reports' }
	];
	function pageHref(page: number) {
		const params = new URLSearchParams();
		if (data.filter !== 'pending') params.set('filter', data.filter);
		if (data.search) params.set('q', data.search);
		if (data.userId) params.set('userId', data.userId);
		if (page > 1) params.set('page', String(page));
		return `/settings/reports${params.size ? `?${params}` : ''}`;
	}
	function actionHref() {
		const params = new URLSearchParams();
		if (data.filter !== 'pending') params.set('filter', data.filter);
		if (data.search) params.set('q', data.search);
		if (data.userId) params.set('userId', data.userId);
		if (data.page > 1) params.set('page', String(data.page));
		return `?/moderate${params.size ? `&${params}` : ''}`;
	}
	const publicCount = $derived(data.counts.pending + data.counts.published);
	const hiddenCount = $derived(data.counts.hidden + data.counts.removed);
</script>

<svelte:head>
	<title>Report Moderation | VapourDB</title>
	<meta name="robots" content="noindex,nofollow" />
</svelte:head>

<section class="container-shell max-w-6xl py-10 sm:py-14">
	<a class="text-sm font-semibold text-mint hover:text-lime" href="/settings">← Account settings</a>
	<nav class="mt-5 flex flex-wrap gap-2" aria-label="Account settings">
		<a
			class="rounded-full border border-line px-4 py-2 text-sm text-slate-200 hover:border-mint/40"
			href="/settings">Profile</a
		>
		<a
			class="rounded-full border border-line px-4 py-2 text-sm text-slate-200 hover:border-mint/40"
			href="/settings/devices">Devices</a
		>
		<a
			class="rounded-full border border-line px-4 py-2 text-sm text-slate-200 hover:border-mint/40"
			href="/settings/users">Users</a
		>
		<span
			class="rounded-full bg-mint/10 px-4 py-2 text-sm font-semibold text-mint"
			aria-current="page">Report Moderation</span
		>
	</nav>

	<div class="mt-7">
		<p class="eyebrow">Private admin tools</p>
		<h1 class="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">
			Report Moderation
		</h1>
		<p class="mt-2 max-w-3xl text-sm leading-6 text-muted">
			Review Linux and Steam Deck compatibility reports submitted by the community.
		</p>
	</div>

	<div
		class="mt-6 rounded-2xl border border-amber-200/25 bg-amber-200/[0.06] p-5 text-sm leading-6 text-amber-50"
	>
		<strong>Unreviewed reports are already public.</strong> Pending reports appear on game pages and user
		profiles and already count toward compatibility ratings. Marking one reviewed keeps its original public
		visibility, score contribution, and submission date.
	</div>

	<div class="mt-5 grid gap-3 sm:grid-cols-3">
		<div class="surface rounded-2xl p-5">
			<p class="text-xs font-semibold tracking-wide text-muted uppercase">Unreviewed</p>
			<p class="mt-2 text-3xl font-black text-amber-100">
				{data.counts.pending.toLocaleString('en-GB')}
			</p>
		</div>
		<div class="surface rounded-2xl p-5">
			<p class="text-xs font-semibold tracking-wide text-muted uppercase">Public</p>
			<p class="mt-2 text-3xl font-black text-mint">{publicCount.toLocaleString('en-GB')}</p>
			<p class="mt-1 text-xs text-muted">Pending + published</p>
		</div>
		<div class="surface rounded-2xl p-5">
			<p class="text-xs font-semibold tracking-wide text-muted uppercase">Hidden / Removed</p>
			<p class="mt-2 text-3xl font-black text-slate-200">{hiddenCount.toLocaleString('en-GB')}</p>
		</div>
	</div>

	{#if form?.error}
		<div
			role="alert"
			class="mt-5 rounded-xl border border-rose-300/20 bg-rose-300/[0.06] p-4 text-sm text-rose-100"
		>
			{form.error}
		</div>
	{/if}
	{#if data.reports.length === 0 && data.total === 0 && data.userId}
		<div class="mt-5 rounded-xl border border-mint/20 bg-mint/[0.06] p-4 text-sm text-mint">
			No reports match this moderator view.
		</div>
	{/if}

	<form
		method="GET"
		class="surface mt-6 grid gap-4 rounded-2xl p-5 sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:items-end"
	>
		<label class="text-xs font-semibold text-slate-300" for="filter"
			>Report state
			<select
				id="filter"
				name="filter"
				class="mt-2 block w-full rounded-xl border border-line bg-panel px-3 py-2.5 text-sm text-slate-200"
			>
				{#each filterOptions as option}<option
						value={option.value}
						selected={data.filter === option.value}>{option.label}</option
					>{/each}
			</select>
		</label>
		<label class="text-xs font-semibold text-slate-300" for="q"
			>Search username, game title, or Steam AppID
			<input
				id="q"
				name="q"
				value={data.search}
				maxlength="100"
				placeholder="Username, game, or AppID"
				class="mt-2 block w-full rounded-xl border border-line bg-black/20 px-3 py-2.5 text-sm text-white"
			/>
		</label>
		{#if data.userId}<input type="hidden" name="userId" value={data.userId} />{/if}
		<button class="rounded-xl bg-mint px-5 py-2.5 text-sm font-extrabold text-ink hover:bg-lime"
			>Apply filters</button
		>
	</form>

	{#if data.userId}
		<p class="mt-4 text-sm text-slate-300">
			Showing reports for a selected account, including every moderation state. <a
				class="font-semibold text-mint hover:text-lime"
				href="/settings/reports">Clear user filter</a
			>
		</p>
	{/if}

	<div class="mt-5 flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
		<p>{data.total.toLocaleString('en-GB')} matching {data.total === 1 ? 'report' : 'reports'}</p>
		{#if data.total > 0}<p>Page {data.page} of {data.pageCount}</p>{/if}
	</div>

	{#if data.reports.length > 0}
		<div class="mt-3 grid gap-4">
			{#each data.reports as report (report.id)}
				<div class="min-w-0" data-report-id={report.id}>
					<NativeReportCard {report} admin />
					<div class="surface mt-2 flex flex-wrap items-center gap-2 rounded-2xl p-4">
						{#if report.moderationState === 'pending'}
							<form method="POST" action={actionHref()}>
								<input type="hidden" name="id" value={report.id} /><input
									type="hidden"
									name="expectedState"
									value="pending"
								/><input type="hidden" name="action" value="review" /><button
									class="rounded-lg bg-mint px-4 py-2 text-xs font-bold text-ink hover:bg-lime"
									>Mark reviewed</button
								>
							</form>
						{/if}
						{#if report.moderationState === 'pending' || report.moderationState === 'published'}
							<form method="POST" action={actionHref()}>
								<input type="hidden" name="id" value={report.id} /><input
									type="hidden"
									name="expectedState"
									value={report.moderationState}
								/><input type="hidden" name="action" value="hide" /><button
									class="rounded-lg border border-line px-4 py-2 text-xs font-semibold text-slate-200 hover:border-mint/40"
									>Hide</button
								>
							</form>
						{/if}
						{#if report.moderationState !== 'removed'}
							<form method="POST" action={actionHref()} class="flex flex-wrap items-center gap-2">
								<input type="hidden" name="id" value={report.id} /><input
									type="hidden"
									name="expectedState"
									value={report.moderationState}
								/><input type="hidden" name="action" value="remove" /><label
									class="flex items-center gap-2 text-xs text-rose-100/80"
									><input
										class="accent-rose-300"
										type="checkbox"
										name="confirm"
										value="yes"
										required
									/>Confirm removal</label
								><button
									class="rounded-lg border border-rose-200/25 px-4 py-2 text-xs font-semibold text-rose-100 hover:border-rose-200/50"
									>Remove report</button
								>
							</form>
						{/if}
						{#if report.moderationState === 'hidden'}
							<form method="POST" action={actionHref()}>
								<input type="hidden" name="id" value={report.id} /><input
									type="hidden"
									name="expectedState"
									value="hidden"
								/><input type="hidden" name="action" value="restore" /><button
									class="rounded-lg border border-mint/25 px-4 py-2 text-xs font-semibold text-mint hover:border-mint/50"
									>Restore</button
								>
							</form>
						{:else if report.moderationState === 'removed'}
							<form method="POST" action={actionHref()} class="flex flex-wrap items-center gap-2">
								<input type="hidden" name="id" value={report.id} /><input
									type="hidden"
									name="expectedState"
									value="removed"
								/><input type="hidden" name="action" value="restore" /><label
									class="flex items-center gap-2 text-xs text-amber-100/80"
									><input
										class="accent-amber-200"
										type="checkbox"
										name="confirm"
										value="yes"
										required
									/>Confirm restoration of removed report</label
								><button
									class="rounded-lg border border-mint/25 px-4 py-2 text-xs font-semibold text-mint hover:border-mint/50"
									>Restore report</button
								>
							</form>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{:else}
		<div class="surface mt-3 rounded-2xl p-7 sm:p-10">
			<h2 class="text-lg font-bold text-white">No reports in this view</h2>
			<p class="mt-2 text-sm leading-6 text-muted">
				Try another moderation state or search term. New reports appear here as they are submitted.
			</p>
		</div>
	{/if}

	{#if data.pageCount > 1}
		<nav class="mt-5 flex items-center justify-between gap-3" aria-label="Moderation report pages">
			{#if data.page > 1}<a
					class="rounded-xl border border-line px-4 py-2 text-sm text-white hover:border-mint/40"
					href={pageHref(data.page - 1)}
					rel="prev">← Previous</a
				>{:else}<span></span>{/if}
			<span class="text-xs text-muted">Page {data.page} of {data.pageCount}</span>
			{#if data.page < data.pageCount}<a
					class="rounded-xl border border-line px-4 py-2 text-sm text-white hover:border-mint/40"
					href={pageHref(data.page + 1)}
					rel="next">Next →</a
				>{:else}<span></span>{/if}
		</nav>
	{/if}
</section>
