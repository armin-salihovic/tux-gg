<script lang="ts">
	import { authClient } from '#lib/auth-client.js';
	let busy = $state(false);
	let message = $state('');
	async function signIn() {
		busy = true;
		message = '';
		const result = await authClient.signIn.social({
			provider: 'discord',
			callbackURL: '/settings'
		});
		if (result.error) {
			message =
				result.error.message ||
				'Discord sign-in could not start. Check the authentication configuration and try again.';
			busy = false;
		}
	}
</script>

<svelte:head
	><title>Sign in | TuxGG</title><meta name="robots" content="noindex,follow" /><meta
		name="description"
		content="Sign in to TuxGG with Discord."
	/></svelte:head
>

<section class="container-shell grid min-h-[65vh] place-items-center py-12">
	<div class="surface w-full max-w-md rounded-3xl p-7 text-center sm:p-9">
		<div
			class="mx-auto grid size-14 place-items-center rounded-2xl border border-mint/25 bg-mint/10 text-2xl font-black text-mint"
		>
			T
		</div>
		<p class="eyebrow mt-6">Your TuxGG account</p>
		<h1 class="mt-2 text-3xl font-black tracking-tight text-white">Sign in with Discord</h1>
		<p class="mt-3 text-sm leading-6 text-muted">
			Use Discord to manage your public profile. Discord sign-in does not grant report publishing
			permissions.
		</p>
		<button
			class="mt-7 w-full rounded-xl bg-mint px-5 py-3.5 font-extrabold text-ink transition hover:bg-lime disabled:cursor-wait disabled:opacity-60"
			disabled={busy}
			onclick={signIn}>{busy ? 'Connecting…' : 'Continue with Discord'}</button
		>
		{#if message}<p
				role="alert"
				class="mt-4 rounded-xl border border-rose-300/20 bg-rose-300/[0.06] p-3 text-left text-sm text-rose-100"
			>
				{message}
			</p>{/if}
		<p class="mt-5 text-xs leading-5 text-slate-500">
			We request your Discord identity and email scope for account setup. Your email is never shown
			on your public profile.
		</p>
	</div>
</section>
