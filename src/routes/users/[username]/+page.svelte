<script lang="ts">
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
	const joined = $derived(
		new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(data.profile.createdAt)
	);
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
		<div class="mt-7 grid w-full max-w-md grid-cols-2 gap-3">
			<div class="rounded-xl border border-white/[0.07] bg-black/10 p-4">
				<div class="text-2xl font-extrabold text-mint">{data.profile.contributionCount}</div>
				<div class="mt-1 text-xs text-muted">public VapourDB reports</div>
			</div>
			<div class="rounded-xl border border-white/[0.07] bg-black/10 p-4">
				<div class="text-sm font-bold text-white">{joined}</div>
				<div class="mt-1 text-xs text-muted">member since</div>
			</div>
		</div>
		<p class="mt-6 text-xs text-slate-500">
			Only public profile information is shown. Account email and OAuth details are private.
		</p>
	</div>
</section>
