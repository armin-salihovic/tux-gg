<script lang="ts">
	import { page } from '$app/state';
	const isNotFound = $derived(page.status === 404);
</script>

<svelte:head>
	<title>{isNotFound ? 'Page not found' : 'Page unavailable'} | TuxGG</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<section class="container-shell py-24 text-center">
	<p class="eyebrow">{isNotFound ? '404' : 'Something went wrong'}</p>
	<h1 class="mt-4 text-4xl font-black tracking-tight text-white">
		{isNotFound ? 'This page is missing.' : 'We could not load this page.'}
	</h1>
	<p class="mx-auto mt-4 max-w-lg text-sm leading-7 text-muted">
		{isNotFound
			? 'The game may have moved, or this address may be out of date.'
			: (page.error?.message ?? 'Please try again in a moment.')}
	</p>
	<a
		class="mt-7 inline-flex rounded-full bg-mint px-5 py-3 text-sm font-bold text-[#07120f] no-underline hover:bg-lime"
		href="/games">Explore the catalog</a
	>
</section>
