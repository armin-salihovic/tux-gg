<script lang="ts">
	import { startSteamLogin } from '#lib/auth-login.js';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();

	let busy = $state(false);
	let message = $state(
		typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('error')
			? 'Steam could not verify this sign-in. Please try again.'
			: ''
	);

	async function signIn() {
		busy = true;
		message = '';
		const result = await startSteamLogin(fetch, data.returnTo);
		if ('error' in result) {
			message = result.error;
			busy = false;
			return;
		}
		window.location.assign(result.url);
	}
</script>

<svelte:head
	><title>Sign in | VapourDB</title><meta name="robots" content="noindex,follow" /><meta
		name="description"
		content="Sign in securely with your Steam account to create or access your VapourDB profile."
	/></svelte:head
>

<section class="container-shell grid min-h-[65vh] place-items-center py-12">
	<div class="surface w-full max-w-md rounded-3xl p-7 text-center sm:p-9">
		<div
			class="mx-auto grid size-14 place-items-center rounded-2xl border border-[#66c0f4]/30 bg-[#66c0f4]/10 text-2xl font-black text-[#9bd5f6]"
		>
			<svg viewBox="0 0 32 32" class="size-8" aria-hidden="true" fill="currentColor">
				<path
					d="M16 2a14 14 0 1 0 0 28 14 14 0 0 0 0-28Zm-3.2 16.1-4.6-2.7 1.1-1.8 4.6 2.7a4.2 4.2 0 1 1-1.1 1.8Zm8.4-6.8a4 4 0 1 1-6.9-2.8 4 4 0 0 1 6.9 2.8Zm-5.5 0a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0Z"
				/>
			</svg>
		</div>
		<p class="eyebrow mt-6">Your VapourDB account</p>
		<h1 class="mt-2 text-3xl font-black tracking-tight text-white">Sign in through Steam</h1>
		<p class="mt-3 text-sm leading-6 text-muted">
			Sign in securely with your Steam account to create or access your VapourDB profile.
		</p>
		<button
			class="mt-7 w-full rounded-xl bg-[#1b2838] px-5 py-3.5 font-extrabold text-white transition hover:bg-[#24374d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#66c0f4] disabled:cursor-wait disabled:opacity-60"
			disabled={busy}
			aria-busy={busy}
			onclick={signIn}>{busy ? 'Connecting to Steam…' : 'Sign in through Steam'}</button
		>
		{#if message}<p
				role="alert"
				class="mt-4 rounded-xl border border-rose-300/20 bg-rose-300/[0.06] p-3 text-left text-sm text-rose-100"
			>
				{message}
			</p>{/if}
		<a class="mt-6 inline-flex text-sm font-semibold text-mint hover:text-lime" href="/games"
			>Continue browsing without signing in →</a
		>
	</div>
</section>
