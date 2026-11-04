<script lang="ts">
	import {
		getNextSteamArtworkIndex,
		getSteamArtworkCandidates,
		type SteamArtworkVariant
	} from '#lib/steam-assets.js';

	type AspectRatio = 'card' | 'header' | 'square';
	type LoadingMode = 'eager' | 'lazy';
	type FetchPriority = 'auto' | 'high' | 'low';

	let {
		appId,
		variant = 'thumbnail',
		aspect = 'card',
		preferredUrl = null,
		alt = '',
		loading = 'lazy',
		fetchPriority = 'auto',
		class: className = '',
		imageClass = ''
	}: {
		appId: string;
		variant?: SteamArtworkVariant;
		aspect?: AspectRatio;
		preferredUrl?: string | null;
		alt?: string;
		loading?: LoadingMode;
		fetchPriority?: FetchPriority;
		class?: string;
		imageClass?: string;
	} = $props();

	const aspectClasses: Record<AspectRatio, string> = {
		card: 'aspect-[616/353]',
		header: 'aspect-[460/215]',
		square: 'aspect-square'
	};
	const intrinsicSizes = {
		thumbnail: { width: 616, height: 353 },
		header: { width: 460, height: 215 }
	};
	let sourceIndex = $state(0);
	let exhausted = $state(false);
	let lastSourceKey = '';
	let candidates = $derived(getSteamArtworkCandidates(appId, variant, preferredUrl));
	let sourceKey = $derived(`${appId}:${variant}:${preferredUrl ?? ''}`);
	let activeSource = $derived(candidates[sourceIndex] ?? null);
	let size = $derived(intrinsicSizes[variant]);

	$effect(() => {
		if (lastSourceKey !== sourceKey) {
			lastSourceKey = sourceKey;
			sourceIndex = 0;
			exhausted = false;
		}
	});

	function handleImageError() {
		const nextIndex = getNextSteamArtworkIndex(sourceIndex, candidates.length);
		if (nextIndex === null) exhausted = true;
		else sourceIndex = nextIndex;
	}
</script>

<div
	class={`relative isolate block overflow-hidden bg-panel ${aspectClasses[aspect]} ${className}`}
>
	{#if activeSource && !exhausted}
		{#key activeSource}
			<img
				class={`absolute inset-0 size-full object-cover ${imageClass}`}
				src={activeSource}
				{alt}
				width={size.width}
				height={size.height}
				{loading}
				fetchpriority={fetchPriority}
				decoding="async"
				onerror={handleImageError}
			/>
		{/key}
	{:else}
		<div
			class="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_22%_20%,rgba(103,232,194,.2),transparent_36%),linear-gradient(125deg,#17333a,#0d171c_62%,#17291f)]"
			aria-hidden="true"
		>
			<div class="relative grid size-full place-items-center overflow-hidden">
				<div
					class="absolute -top-10 -right-4 size-44 rounded-full border border-white/[0.07]"
				></div>
				<div class="absolute -top-2 -right-1 size-32 rounded-full border border-white/[0.08]"></div>
				<div class="relative text-center">
					<div class="text-xl font-black tracking-[-0.04em] text-white/80">
						Tux<span class="text-mint">GG</span>
					</div>
					<div class="mt-1 text-[0.6rem] font-semibold tracking-[0.16em] text-white/45">
						STEAM APP {appId}
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>
