<script lang="ts">
	import { TIER_LABELS, type CompatibilityTier } from '#lib/scoring.js';
	let { tier }: { tier: CompatibilityTier | string } = $props();
	const styles: Record<string, string> = {
		platinum: 'border-cyan-300/25 bg-cyan-300/10 text-cyan-200',
		gold: 'border-amber-300/25 bg-amber-300/10 text-amber-200',
		silver: 'border-slate-300/25 bg-slate-300/10 text-slate-200',
		bronze: 'border-orange-300/25 bg-orange-300/10 text-orange-200',
		borked: 'border-rose-300/25 bg-rose-300/10 text-rose-200',
		unknown: 'border-slate-500/25 bg-slate-500/10 text-slate-300'
	};
	let normalized = $derived(tier in TIER_LABELS ? (tier as CompatibilityTier) : 'unknown');
</script>

<span
	class={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold tracking-wide ${styles[normalized]}`}
>
	<span class="size-1.5 rounded-full bg-current"></span>
	{TIER_LABELS[normalized]}
</span>
