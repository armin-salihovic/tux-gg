<script lang="ts">
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Registered users | VapourDB</title>
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
		<span
			class="rounded-full bg-mint/10 px-4 py-2 text-sm font-semibold text-mint"
			aria-current="page">Users</span
		>
		<a
			class="rounded-full border border-line px-4 py-2 text-sm text-slate-200 hover:border-mint/40"
			href="/settings/reports">Report Moderation</a
		>
	</nav>

	<div class="mt-7 flex flex-wrap items-end justify-between gap-4">
		<div>
			<p class="eyebrow">Private account overview</p>
			<h1 class="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">
				Registered VapourDB users
			</h1>
			<p class="mt-2 text-sm leading-6 text-muted">
				{data.totalUsers.toLocaleString('en-GB')} registered {data.totalUsers === 1
					? 'user'
					: 'users'}. Review totals include every moderation status.
			</p>
		</div>
	</div>

	{#if data.users.length === 0}
		<div class="surface mt-7 rounded-2xl p-7 sm:p-10">
			<h2 class="text-lg font-bold text-white">No registered users yet</h2>
			<p class="mt-2 text-sm leading-6 text-muted">
				New accounts will appear here after registration.
			</p>
		</div>
	{:else}
		<div class="surface mt-7 overflow-hidden rounded-2xl">
			<div class="overflow-x-auto">
				<table class="w-full min-w-[48rem] border-collapse text-left text-sm">
					<caption class="sr-only">Registered VapourDB accounts and reviews submitted</caption>
					<thead
						class="border-b border-line bg-black/15 text-xs tracking-wide text-slate-400 uppercase"
					>
						<tr>
							<th class="px-5 py-4 font-semibold" scope="col">VapourDB username / display name</th>
							<th class="px-5 py-4 font-semibold" scope="col">Registration date</th>
							<th class="px-5 py-4 text-right font-semibold" scope="col">Reviews submitted</th>
							<th class="px-5 py-4 text-right font-semibold" scope="col">Reports</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-line/70">
						{#each data.users as user (`${user.username}-${user.registeredAt}`)}
							<tr>
								<td class="px-5 py-4">
									{#if user.profilePath}
										<a class="font-semibold text-mint hover:text-lime" href={user.profilePath}
											>{user.username}</a
										>
									{:else}<span class="font-semibold text-slate-200">{user.username}</span>{/if}
									<p class="mt-1 text-xs text-muted">{user.name}</p>
								</td>
								<td class="px-5 py-4 whitespace-nowrap text-slate-300">
									<time datetime={user.registeredAt}>{user.registeredAtLabel}</time>
								</td>
								<td class="px-5 py-4 text-right text-slate-200 tabular-nums">
									{user.reviewsSubmitted.toLocaleString('en-GB')}
								</td>
								<td class="px-5 py-4 text-right">
									<a
										class="font-semibold text-mint hover:text-lime"
										href={`/settings/reports?filter=all&userId=${encodeURIComponent(user.userId)}`}
										>View reports</a
									>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	{/if}

	<div class="mt-5 flex flex-wrap items-center justify-between gap-3">
		<p class="text-sm text-muted">Page {data.page} of {data.pageCount}</p>
		<nav class="flex gap-2" aria-label="User table pages">
			{#if data.page > 1}
				<a
					class="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-slate-200 hover:border-mint/40 hover:text-mint"
					href={data.page === 2 ? '/settings/users' : `/settings/users?page=${data.page - 1}`}
					rel="prev">Previous</a
				>
			{:else}
				<span
					class="rounded-lg border border-line/60 px-4 py-2 text-sm text-slate-500"
					aria-disabled="true">Previous</span
				>
			{/if}
			{#if data.page < data.pageCount}
				<a
					class="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-slate-200 hover:border-mint/40 hover:text-mint"
					href={`/settings/users?page=${data.page + 1}`}
					rel="next">Next</a
				>
			{:else}
				<span
					class="rounded-lg border border-line/60 px-4 py-2 text-sm text-slate-500"
					aria-disabled="true">Next</span
				>
			{/if}
		</nav>
	</div>
	<p class="mt-4 text-xs leading-5 text-slate-500">
		“Reviews submitted” counts all reports, including pending, published, hidden, and removed
		entries.
	</p>
</section>
