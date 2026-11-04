<script lang="ts">
	interface Report {
		id: number;
		source: string;
		submittedAt: Date | null;
		sourceVerdict: string | null;
		sourceRating: string | null;
		protonVersion: string | null;
		protonVariant: string | null;
		customProtonVersion: string | null;
		distribution: string | null;
		kernel: string | null;
		cpu: string | null;
		gpu: string | null;
		gpuVendor: string | null;
		graphicsDriver: string | null;
		ram: string | null;
		steamRuntimeVersion: string | null;
		xWindowManager: string | null;
		launchOptions: string | null;
		comments: string | null;
	}
	let { report }: { report: Report } = $props();
	const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });
	const sourceOutcome = $derived(
		report.sourceVerdict
			? `Source verdict: ${report.sourceVerdict}`
			: report.sourceRating
				? `Source rating: ${report.sourceRating}`
				: 'Source result not recorded'
	);
	const proton = $derived(
		[report.protonVariant, report.protonVersion, report.customProtonVersion]
			.filter(Boolean)
			.join(' · ')
	);
</script>

<article class="surface rounded-2xl p-5 sm:p-6">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<div class="flex flex-wrap items-center gap-2">
				<span
					class="rounded-full border border-mint/20 bg-mint/10 px-2.5 py-1 text-[0.68rem] font-bold tracking-[0.12em] text-mint uppercase"
					>Imported from ProtonDB</span
				>
				<span class="text-xs text-muted">{sourceOutcome}</span>
			</div>
			<p class="mt-3 text-xs text-muted">
				{report.submittedAt ? dateFormat.format(report.submittedAt) : 'Date unavailable'}
			</p>
		</div>
		{#if proton}<span
				class="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-medium text-slate-200"
				>{proton}</span
			>{/if}
	</div>

	{#if report.comments}
		<p class="mt-5 text-sm leading-7 break-words whitespace-pre-wrap text-slate-200">
			{report.comments}
		</p>
	{/if}

	<div
		class="mt-5 grid gap-x-6 gap-y-4 border-t border-white/[0.07] pt-5 text-xs sm:grid-cols-2 lg:grid-cols-3"
	>
		{#if report.distribution}<div>
				<div class="text-[0.65rem] font-bold tracking-[0.14em] text-slate-500 uppercase">
					Linux system
				</div>
				<div class="mt-1.5 text-slate-200">{report.distribution}</div>
			</div>{/if}
		{#if report.gpu}<div>
				<div class="text-[0.65rem] font-bold tracking-[0.14em] text-slate-500 uppercase">GPU</div>
				<div class="mt-1.5 text-slate-200">{report.gpu}</div>
			</div>{/if}
		{#if report.graphicsDriver}<div>
				<div class="text-[0.65rem] font-bold tracking-[0.14em] text-slate-500 uppercase">
					Graphics driver
				</div>
				<div class="mt-1.5 text-slate-200">{report.graphicsDriver}</div>
			</div>{/if}
		{#if report.cpu}<div>
				<div class="text-[0.65rem] font-bold tracking-[0.14em] text-slate-500 uppercase">CPU</div>
				<div class="mt-1.5 text-slate-200">{report.cpu}</div>
			</div>{/if}
		{#if report.kernel}<div>
				<div class="text-[0.65rem] font-bold tracking-[0.14em] text-slate-500 uppercase">
					Kernel
				</div>
				<div class="mt-1.5 text-slate-200">{report.kernel}</div>
			</div>{/if}
		{#if report.ram}<div>
				<div class="text-[0.65rem] font-bold tracking-[0.14em] text-slate-500 uppercase">
					Memory
				</div>
				<div class="mt-1.5 text-slate-200">{report.ram}</div>
			</div>{/if}
		{#if report.steamRuntimeVersion}<div>
				<div class="text-[0.65rem] font-bold tracking-[0.14em] text-slate-500 uppercase">
					Steam runtime
				</div>
				<div class="mt-1.5 text-slate-200">{report.steamRuntimeVersion}</div>
			</div>{/if}
		{#if report.launchOptions}<div class="sm:col-span-2">
				<div class="text-[0.65rem] font-bold tracking-[0.14em] text-slate-500 uppercase">
					Launch options
				</div>
				<code
					class="mt-1.5 block rounded-lg border border-white/[0.07] bg-black/20 px-3 py-2 break-all text-slate-200"
					>{report.launchOptions}</code
				>
			</div>{/if}
	</div>
</article>
