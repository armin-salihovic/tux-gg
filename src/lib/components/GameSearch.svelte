<script lang="ts">
	let { value = '', compact = false }: { value?: string; compact?: boolean } = $props();
</script>

<form
	class="flex w-full gap-2 rounded-2xl border border-white/10 bg-[#0a151a] p-2 shadow-[0_20px_70px_rgba(0,0,0,.28)] focus-within:border-mint/50"
	action="/games"
	method="GET"
	role="search"
>
	<label class="sr-only" for={compact ? 'game-search-compact' : 'game-search'}
		>Search Linux game compatibility</label
	>
	<span
		class="grid size-11 shrink-0 place-items-center rounded-xl bg-white/[0.04] text-xl text-mint"
		aria-hidden="true">⌕</span
	>
	<input
		id={compact ? 'game-search-compact' : 'game-search'}
		class="min-w-0 flex-1 bg-transparent px-1 text-sm text-white outline-none placeholder:text-slate-500 sm:text-base"
		name="q"
		{value}
		placeholder="Search games or paste a Steam app ID…"
		autocomplete="off"
		maxlength="100"
	/>
	<button
		class="hidden rounded-xl bg-mint px-5 text-sm font-bold text-[#07120f] transition hover:bg-lime sm:inline-flex sm:items-center"
		type="submit">Search</button
	>
	<button
		class="rounded-xl bg-mint px-4 text-sm font-bold text-[#07120f] sm:hidden"
		type="submit"
		aria-label="Search">Go</button
	>
</form>
