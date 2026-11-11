<script lang="ts">
	import type { ActionData, PageData } from './$types';
	import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, USERNAME_PATTERN } from '#lib/usernames.js';
	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head
	><title>Account settings | VapourDB</title><meta
		name="robots"
		content="noindex,follow"
	/></svelte:head
>

<section class="container-shell max-w-3xl py-12 sm:py-16">
	<p class="eyebrow">Account</p>
	<h1 class="mt-2 text-3xl font-black tracking-tight text-white">Profile settings</h1>
	<p class="mt-2 text-sm text-muted">
		Your VapourDB username and display name appear on your public profile.
	</p>
	<nav class="mt-6 flex flex-wrap gap-2" aria-label="Account settings">
		<a class="rounded-full bg-mint/10 px-4 py-2 text-sm font-semibold text-mint" href="/settings"
			>Profile</a
		>
		<a
			class="rounded-full border border-line px-4 py-2 text-sm font-semibold text-slate-200 hover:border-mint/40 hover:text-mint"
			href="/settings/devices">Devices</a
		>
		{#if data.isOwnerAdmin}<a
				class="rounded-full border border-line px-4 py-2 text-sm font-semibold text-slate-200 hover:border-mint/40 hover:text-mint"
				href="/settings/users">Users</a
			><a
				class="rounded-full border border-line px-4 py-2 text-sm font-semibold text-slate-200 hover:border-mint/40 hover:text-mint"
				href="/settings/reports">Report Moderation</a
			>{/if}
	</nav>
	{#if data.saved}<div
			role="status"
			class="mt-6 rounded-xl border border-mint/20 bg-mint/[0.06] p-4 text-sm text-mint"
		>
			Profile saved.
		</div>{/if}
	{#if form?.error}<div
			role="alert"
			class="mt-6 rounded-xl border border-rose-300/20 bg-rose-300/[0.06] p-4 text-sm text-rose-100"
		>
			{form.error}
		</div>{/if}
	<form method="POST" action="?/profile" class="surface mt-6 space-y-5 rounded-2xl p-6">
		<label class="block text-sm font-semibold text-slate-200" for="name"
			>VapourDB display name<input
				id="name"
				name="name"
				required
				maxlength="60"
				value={data.profile.name}
				class="mt-2 block w-full rounded-xl border border-line bg-black/20 px-4 py-3 text-sm text-white"
			/></label
		>
		<label class="block text-sm font-semibold text-slate-200" for="username"
			>Username<input
				id="username"
				name="username"
				required
				minlength={USERNAME_MIN_LENGTH}
				maxlength={USERNAME_MAX_LENGTH}
				pattern={USERNAME_PATTERN.source}
				value={data.profile.username}
				class="mt-2 block w-full rounded-xl border border-line bg-black/20 px-4 py-3 text-sm text-white"
			/><span class="mt-2 block text-xs font-normal text-muted"
				>3–32 characters; start with a lowercase letter or number, then use lowercase letters,
				numbers, underscores, or hyphens. Public profile: /users/{data.profile.username}</span
			></label
		>
		<button class="rounded-xl bg-mint px-5 py-3 text-sm font-extrabold text-ink hover:bg-lime"
			>Save profile</button
		>
	</form>
	<div class="surface mt-5 rounded-2xl p-6">
		<h2 class="font-bold text-white">Steam account</h2>
		{#if data.profile.steamConnected}
			<div class="mt-4 flex items-center gap-4">
				{#if data.profile.image}
					<img class="size-14 rounded-full object-cover" src={data.profile.image} alt="" />
				{:else}
					<span
						class="grid size-14 place-items-center rounded-full bg-panel-soft text-xl font-bold text-mint"
						>{data.profile.name.slice(0, 1).toUpperCase()}</span
					>
				{/if}
				<div>
					<p class="font-semibold text-white">{data.profile.name}</p>
					<p class="mt-1 text-xs text-muted">Steam display name</p>
				</div>
			</div>
			<dl class="mt-5 grid gap-3 text-sm sm:grid-cols-[9rem_1fr]">
				<dt class="text-muted">SteamID64</dt>
				<dd class="font-mono text-slate-200">{data.profile.steamId}</dd>
				<dt class="text-muted">Steam profile</dt>
				<dd>
					<a
						class="text-mint hover:text-lime"
						href={data.profile.steamProfileUrl}
						target="_blank"
						rel="noreferrer">Open Steam profile ↗</a
					>
				</dd>
			</dl>
		{:else}
			<p class="mt-2 text-sm text-muted">No Steam account is connected.</p>
		{/if}
		<p class="mt-5 text-xs leading-5 text-slate-500">
			Your Steam account can submit compatibility reports. Each report appears publicly after
			submission and may be moderated later.
		</p>
	</div>
	<a
		class="mt-6 inline-flex text-sm font-semibold text-mint hover:text-lime"
		href={`/users/${data.profile.username}`}>View your public profile →</a
	>
</section>
