<script lang="ts">
	let {
		title,
		description,
		actionHref = '/games',
		actionLabel = 'Browse games'
	}: { title: string; description: string; actionHref?: string; actionLabel?: string } = $props();
</script>

<div class="surface rounded-2xl px-6 py-12 text-center">
	<div
		class="mx-auto grid size-12 place-items-center rounded-2xl border border-mint/20 bg-mint/10 text-xl text-mint"
		aria-hidden="true"
	>
		⌕
	</div>
	<h2 class="mt-4 text-lg font-bold text-white">{title}</h2>
	<p class="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">{description}</p>
	<a
		class="mt-5 inline-flex rounded-full bg-mint px-4 py-2 text-sm font-bold text-[#07120f] no-underline transition hover:bg-lime"
		href={actionHref}>{actionLabel}</a
	>
</div>
