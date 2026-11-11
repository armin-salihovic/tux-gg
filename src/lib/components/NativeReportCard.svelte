<script lang="ts">
	import { formatGpuName } from '#lib/gpu-format.js';
	import GameArtwork from '#lib/components/GameArtwork.svelte';

	export type NativeReportCardData = {
		id: string;
		appId: string;
		gameTitle: string;
		gameSlug: string;
		artworkUrl?: string | null;
		authorUsername?: string;
		verdict: string;
		platform?: string | null;
		moderationState?: string;
		createdAt: Date | string;
		content?: string | null;
		deviceNameSnapshot?: string | null;
		gpu?: string | null;
		gpuVendor?: string | null;
		cpu?: string | null;
		ram?: string | null;
		distribution?: string | null;
		kernel?: string | null;
		graphicsDriver?: string | null;
		gpuDriverDetail?: string | null;
		protonVersion?: string | null;
		protonVariant?: string | null;
		customProtonVersion?: string | null;
		performanceNotes?: string | null;
		knownIssues?: string | null;
		launchOptions?: string | null;
	};
	let {
		report,
		showGame = true,
		showAuthor = true,
		admin = false
	}: {
		report: NativeReportCardData;
		showGame?: boolean;
		showAuthor?: boolean;
		admin?: boolean;
	} = $props();
	const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });
	const createdAt = $derived(
		report.createdAt instanceof Date ? report.createdAt : new Date(report.createdAt)
	);
	const proton = $derived(
		[report.protonVariant, report.protonVersion, report.customProtonVersion]
			.filter(Boolean)
			.join(' · ')
	);
	const graphics = $derived(
		[formatGpuName(report.gpuVendor, report.gpu), report.graphicsDriver, report.gpuDriverDetail]
			.filter(Boolean)
			.join(' · ')
	);
	const system = $derived(
		[report.cpu, report.kernel ? `Kernel ${report.kernel}` : null, report.ram]
			.filter(Boolean)
			.join(' · ')
	);
	const detailAvailable = $derived(
		Boolean(
			report.deviceNameSnapshot ||
			proton ||
			report.distribution ||
			graphics ||
			system ||
			report.launchOptions
		)
	);
</script>

<article class="surface min-w-0 rounded-2xl p-5 sm:p-6">
	{#if showGame}
		<div class="flex min-w-0 items-center gap-4 border-b border-white/[0.06] pb-4">
			<a
				class="w-24 shrink-0 overflow-hidden rounded-lg"
				href={`/games/${report.appId}/${report.gameSlug}`}
			>
				<GameArtwork
					appId={report.appId}
					variant="thumbnail"
					preferredUrl={report.artworkUrl}
					alt=""
					class="rounded-lg"
				/>
			</a>
			<div class="min-w-0">
				<a
					class="font-bold break-words text-base text-white hover:text-mint"
					href={`/games/${report.appId}/${report.gameSlug}`}
				>
					{report.gameTitle}
				</a>
				<p class="mt-1 text-xs text-muted">Steam app {report.appId}</p>
			</div>
		</div>
	{/if}
	<div class="flex flex-wrap items-start justify-between gap-3 {showGame ? 'mt-4' : ''}">
		<div>
			{#if showAuthor && report.authorUsername}
				<a
					class="font-bold text-white hover:text-mint"
					href={`/users/${encodeURIComponent(report.authorUsername)}`}
				>
					@{report.authorUsername}
				</a>
			{/if}
			<p class="mt-1 text-sm text-slate-300">
				{report.verdict === 'yes' ? 'Works' : "Doesn't work"}
				<span class="px-1.5 text-slate-600">·</span>
				{report.platform === 'steam_deck'
					? 'Steam Deck'
					: report.platform === 'linux_desktop'
						? 'Linux Desktop'
						: 'Platform not specified'}
			</p>
		</div>
		<div class="flex flex-col items-end gap-1 text-right">
			<time class="text-xs text-muted" datetime={createdAt.toISOString()}
				>{dateFormat.format(createdAt)}</time
			>
			{#if admin && report.moderationState}
				<span
					class="rounded-full border border-line px-2.5 py-1 text-[0.68rem] font-semibold text-slate-300"
					>{report.moderationState}</span
				>
			{/if}
		</div>
	</div>
	{#if admin}
		<p class="mt-3 font-mono text-[0.7rem] break-all text-slate-500">Report {report.id}</p>
	{/if}
	{#if detailAvailable}
		{#if report.deviceNameSnapshot}
			<h3 class="mt-4 border-t border-white/[0.06] pt-4 text-sm font-bold text-white">
				{report.deviceNameSnapshot}
			</h3>
		{/if}
		<dl class="mt-4 grid gap-x-5 gap-y-3 border-t border-white/[0.06] pt-4 sm:grid-cols-2">
			{#if proton}<div>
					<dt class="text-[0.68rem] font-semibold tracking-wide text-slate-500 uppercase">
						Proton
					</dt>
					<dd class="mt-0.5 text-sm break-words text-slate-200">{proton}</dd>
				</div>{/if}
			{#if report.distribution}<div>
					<dt class="text-[0.68rem] font-semibold tracking-wide text-slate-500 uppercase">
						Distribution
					</dt>
					<dd class="mt-0.5 text-sm break-words text-slate-200">{report.distribution}</dd>
				</div>{/if}
			{#if graphics}<div>
					<dt class="text-[0.68rem] font-semibold tracking-wide text-slate-500 uppercase">
						Graphics
					</dt>
					<dd class="mt-0.5 text-sm break-words text-slate-200">{graphics}</dd>
				</div>{/if}
			{#if system}<div>
					<dt class="text-[0.68rem] font-semibold tracking-wide text-slate-500 uppercase">
						System
					</dt>
					<dd class="mt-0.5 text-sm break-words text-slate-200">{system}</dd>
				</div>{/if}
			{#if report.launchOptions}<div class="sm:col-span-2">
					<dt class="text-[0.68rem] font-semibold tracking-wide text-slate-500 uppercase">
						Launch options
					</dt>
					<dd class="mt-0.5 font-mono text-xs break-all text-mint">{report.launchOptions}</dd>
				</div>{/if}
		</dl>
	{/if}
	{#if report.content}<p
			class="mt-4 text-sm leading-6 break-words whitespace-pre-wrap text-slate-200"
		>
			{report.content}
		</p>{/if}
	{#if report.performanceNotes}<div class="mt-4 rounded-xl bg-white/[0.035] p-3">
			<p class="text-xs font-semibold text-slate-400">Performance notes</p>
			<p class="mt-1 text-sm leading-6 break-words whitespace-pre-wrap text-slate-200">
				{report.performanceNotes}
			</p>
		</div>{/if}
	{#if report.knownIssues}<div class="mt-3 rounded-xl bg-rose-200/[0.04] p-3">
			<p class="text-xs font-semibold text-rose-100/80">Known issues</p>
			<p class="mt-1 text-sm leading-6 break-words whitespace-pre-wrap text-slate-200">
				{report.knownIssues}
			</p>
		</div>{/if}
</article>
