<script lang="ts">
	import type { Snippet } from 'svelte';
	import TopNav from '#lib/components/TopNav.svelte';
	import '../app.css';
	let {
		children,
		data
	}: {
		children: Snippet;
		data: { user: { name: string; username: string; image: string | null } | null };
	} = $props();
</script>

<svelte:head>
	<meta name="theme-color" content="#091014" />
	<meta property="og:site_name" content="TuxGG" />
</svelte:head>

<div class="flex min-h-screen flex-col">
	<TopNav user={data.user} />
	<main class="flex-1">
		{@render children()}
	</main>
	<footer class="mt-20 border-t border-white/[0.06] bg-black/10">
		<div class="container-shell grid gap-8 py-9 sm:grid-cols-[1fr_auto] sm:items-end">
			<div>
				<a class="font-extrabold tracking-tight text-base text-white no-underline" href="/"
					>Tux<span class="text-mint">GG</span></a
				>
				<p class="mt-2 max-w-xl text-xs leading-5 text-muted">
					A preserved Steam game catalog with player-submitted Linux compatibility reports.
				</p>
			</div>
			<div class="flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-400">
				<a class="hover:text-mint" href="/data-sources">Data sources</a>
				<a class="hover:text-mint" href="/privacy">Privacy</a>
				<a class="hover:text-mint" href="/terms">Terms</a>
				<a class="hover:text-mint" href="/community-rules">Community rules</a>
				<a class="hover:text-mint" href="/contact">Contact</a>
			</div>
		</div>
	</footer>
</div>
