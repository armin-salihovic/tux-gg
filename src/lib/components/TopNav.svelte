<script lang="ts">
	import { authClient } from '#lib/auth-client.js';

	interface PublicUser {
		name: string;
		username: string;
		image: string | null;
	}

	let { user }: { user: PublicUser | null } = $props();
	let menuOpen = $state(false);

	async function signOut() {
		await authClient.signOut();
		window.location.assign('/');
	}
</script>

<header class="sticky top-0 z-40 border-b border-white/5 bg-base/90 backdrop-blur-xl">
	<div class="container-shell flex h-[4.5rem] items-center justify-between gap-6">
		<a class="flex items-center gap-3 no-underline" href="/" aria-label="TuxGG home">
			<span
				class="grid size-9 place-items-center rounded-xl border border-mint/25 bg-mint/10 text-sm font-black text-mint"
				>T</span
			>
			<span class="text-lg font-extrabold tracking-tight text-white"
				>Tux<span class="text-mint">GG</span></span
			>
		</a>

		<nav
			class="hidden items-center gap-7 text-sm font-medium text-slate-300 md:flex"
			aria-label="Main navigation"
		>
			<a class="transition hover:text-mint" href="/games">Games</a>
			<a class="transition hover:text-mint" href="/about">About</a>
			<a class="transition hover:text-mint" href="/methodology">Rating</a>
			<a class="transition hover:text-mint" href="/data-sources">Data sources</a>
		</nav>

		<div class="hidden items-center gap-3 md:flex">
			{#if user}
				<a
					class="flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-sm text-slate-200 transition hover:border-mint/40"
					href="/settings"
				>
					{#if user.image}
						<img
							class="size-6 rounded-full object-cover"
							src={user.image}
							alt=""
							referrerpolicy="no-referrer"
						/>
					{:else}
						<span
							class="grid size-6 place-items-center rounded-full bg-panel-soft text-xs text-mint"
							>{user.name.slice(0, 1).toUpperCase()}</span
						>
					{/if}
					<span>{user.name}</span>
				</a>
				<button
					class="rounded-full px-3 py-2 text-sm text-slate-400 transition hover:text-white"
					onclick={signOut}>Log out</button
				>
			{:else}
				<a
					class="rounded-full border border-line px-4 py-2 text-sm font-semibold text-slate-100 transition hover:border-mint/50 hover:text-mint"
					href="/login">Log in</a
				>
			{/if}
		</div>

		<button
			class="grid size-10 place-items-center rounded-xl border border-line text-slate-200 md:hidden"
			aria-label="Toggle navigation"
			aria-expanded={menuOpen}
			onclick={() => (menuOpen = !menuOpen)}
		>
			<span class="text-xl">{menuOpen ? '×' : '☰'}</span>
		</button>
	</div>

	{#if menuOpen}
		<nav
			class="container-shell grid gap-1 border-t border-white/5 py-3 text-sm md:hidden"
			aria-label="Mobile navigation"
		>
			<a
				class="rounded-lg px-3 py-2 text-slate-200 hover:bg-white/5"
				href="/games"
				onclick={() => (menuOpen = false)}>Games</a
			>
			<a
				class="rounded-lg px-3 py-2 text-slate-200 hover:bg-white/5"
				href="/about"
				onclick={() => (menuOpen = false)}>About</a
			>
			<a
				class="rounded-lg px-3 py-2 text-slate-200 hover:bg-white/5"
				href="/methodology"
				onclick={() => (menuOpen = false)}>Rating methodology</a
			>
			<a
				class="rounded-lg px-3 py-2 text-slate-200 hover:bg-white/5"
				href="/data-sources"
				onclick={() => (menuOpen = false)}>Data sources</a
			>
			{#if user}
				<a
					class="rounded-lg px-3 py-2 text-slate-200 hover:bg-white/5"
					href="/settings"
					onclick={() => (menuOpen = false)}>Account settings</a
				>
				<button
					class="rounded-lg px-3 py-2 text-left text-slate-200 hover:bg-white/5"
					onclick={signOut}>Log out</button
				>
			{:else}
				<a
					class="rounded-lg px-3 py-2 text-mint hover:bg-white/5"
					href="/login"
					onclick={() => (menuOpen = false)}>Log in with Discord</a
				>
			{/if}
		</nav>
	{/if}
</header>
