<script lang="ts">
	import GameArtwork from '#lib/components/GameArtwork.svelte';
	import CompatibilityBadge from '#lib/components/CompatibilityBadge.svelte';

	interface CardGame {
		appId: string;
		title: string | null;
		slug: string;
		reportCount: number;
		yesCount: number;
		noCount: number;
		tier: string;
		artworkUrl?: string | null;
		lastReportAt?: Date | null;
	}
	let { game, compact = false }: { game: CardGame; compact?: boolean } = $props();
</script>

<a
	class="group surface flex h-full flex-col overflow-hidden rounded-2xl no-underline transition duration-200 hover:-translate-y-1 hover:border-mint/30 hover:shadow-[0_25px_70px_rgba(0,0,0,.34)]"
	href={`/games/${game.appId}/${game.slug}`}
>
	<div class="relative">
		<GameArtwork
			appId={game.appId}
			variant={compact ? 'header' : 'thumbnail'}
			aspect={compact ? 'header' : 'card'}
			preferredUrl={game.artworkUrl}
			alt=""
			loading="lazy"
			class="w-full"
			imageClass="transition duration-500 group-hover:scale-[1.03]"
		/>
	</div>
	<div class="flex flex-1 flex-col p-4">
		<div class="mb-3"><CompatibilityBadge tier={game.tier} /></div>
		<div class="flex items-start justify-between gap-3">
			<h3 class="line-clamp-2 leading-snug font-bold text-base text-white group-hover:text-mint">
				{game.title ?? `Steam app ${game.appId}`}
			</h3>
			<span
				class="mt-1 text-lg leading-none text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-mint"
				aria-hidden="true">↗</span
			>
		</div>
		<div class="mt-auto flex items-center justify-between gap-2 pt-5 text-xs text-muted">
			{#if game.reportCount}
				<span
					>{game.reportCount.toLocaleString()} community {game.reportCount === 1
						? 'report'
						: 'reports'}</span
				>
				<span class="text-mint">{game.yesCount} yes · {game.noCount} no</span>
			{:else}
				<span>No community reports yet</span>
			{/if}
		</div>
	</div>
</a>
