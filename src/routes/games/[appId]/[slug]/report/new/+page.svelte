<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import type { PageData } from './$types';
	import GameArtwork from '#lib/components/GameArtwork.svelte';
	import { nativeReportLimits } from '#lib/native-report-validation.js';

	type ReportFormState = {
		values?: Record<string, string>;
		errors?: Record<string, string[] | undefined>;
		formError?: string;
	};
	let { data, form }: { data: PageData; form?: ReportFormState } = $props();
	let submitting = $state(false);
	let selectedDeviceId = $state('');
	$effect(() => {
		if (data.devices.some((device) => device.id === selectedDeviceId)) return;
		const submittedDeviceId = form?.values?.deviceId;
		if (submittedDeviceId && data.devices.some((device) => device.id === submittedDeviceId)) {
			selectedDeviceId = submittedDeviceId;
			return;
		}
		selectedDeviceId =
			data.devices.find((device) => device.isDefault)?.id ?? data.devices[0]?.id ?? '';
	});
	const selectedDevice = $derived(data.devices.find((device) => device.id === selectedDeviceId));
	const fieldError = (name: string) => form?.errors?.[name]?.[0];
	const enhanceReport: SubmitFunction = ({ formElement, formData }) => {
		const submittedDeviceId = formElement.querySelector<HTMLSelectElement>('#deviceId')?.value;
		if (submittedDeviceId) formData.set('deviceId', submittedDeviceId);
		submitting = true;
		return async ({ result, update }) => {
			try {
				if (result.type === 'failure' && typeof submittedDeviceId === 'string') {
					const returnedForm = result.data as ReportFormState;
					if (returnedForm.values) returnedForm.values.deviceId = submittedDeviceId;
				}
				await update({ reset: false, refreshAll: false });
				if (typeof submittedDeviceId === 'string') selectedDeviceId = submittedDeviceId;
			} finally {
				submitting = false;
			}
		};
	};
</script>

<svelte:head>
	<title>Write a report for {data.game.title} | TuxGG</title>
	<meta name="robots" content="noindex,follow" />
</svelte:head>

<section class="container-shell max-w-4xl py-10 sm:py-14">
	<a
		class="text-sm font-semibold text-mint hover:text-lime"
		href={`/games/${data.game.appId}/${data.game.slug}`}>← Back to {data.game.title}</a
	>
	<div class="surface mt-5 overflow-hidden rounded-3xl">
		<div class="flex items-center gap-4 border-b border-white/[0.06] p-5 sm:p-7">
			<GameArtwork
				appId={data.game.appId}
				variant="thumbnail"
				aspect="card"
				preferredUrl={data.game.artworkUrl}
				alt=""
				class="w-24 shrink-0 rounded-xl"
			/>
			<div>
				<p class="eyebrow">Community contribution</p>
				<h1 class="mt-1 text-2xl font-black tracking-tight text-white sm:text-3xl">
					Write a report
				</h1>
				<p class="mt-1 text-sm text-slate-300">{data.game.title}</p>
			</div>
		</div>

		{#if data.devices.length === 0}
			<div class="p-5 sm:p-8">
				<div class="rounded-2xl border border-mint/20 bg-mint/[0.05] p-5 sm:p-6">
					{#if data.hasUnverifiedDevices && data.reimportDeviceId}
						<h2 class="font-bold text-white">Reimport a saved device to write this report</h2>
						<p class="mt-2 text-sm leading-6 text-slate-300">
							Your existing device needs fresh Steam System Information before it can be used for a
							compatibility report.
						</p>
						<a
							class="mt-5 inline-flex rounded-xl bg-mint px-4 py-2.5 text-sm font-extrabold text-ink hover:bg-lime"
							href={`/settings/devices/${data.reimportDeviceId}/edit?returnTo=${encodeURIComponent(data.returnTo)}`}
							>Reimport Steam System Information</a
						>
					{:else}
						<h2 class="font-bold text-white">Add a Linux PC or Steam Deck to write this report</h2>
						<p class="mt-2 text-sm leading-6 text-slate-300">
							Add a Linux PC or Steam Deck to your account before writing a compatibility report.
						</p>
						<a
							class="mt-5 inline-flex rounded-xl bg-mint px-4 py-2.5 text-sm font-extrabold text-ink hover:bg-lime"
							href={`/settings/devices/new?returnTo=${encodeURIComponent(data.returnTo)}`}
							>Add Device</a
						>
					{/if}
				</div>
			</div>
		{:else}
			<form method="POST" use:enhance={enhanceReport} class="space-y-7 p-5 sm:p-8">
				<input type="hidden" name="id" value={form?.values?.id ?? data.submissionId} />
				{#if form?.formError}<p
						role="alert"
						class="rounded-xl border border-rose-200/20 bg-rose-200/[0.06] p-3 text-sm text-rose-100"
					>
						{form.formError}
					</p>{/if}

				<div class="grid gap-5 sm:grid-cols-2">
					<div>
						<label for="verdict" class="block text-sm font-semibold text-white"
							>Compatibility verdict <span class="text-mint">*</span></label
						>
						<select
							id="verdict"
							name="verdict"
							required
							aria-invalid={Boolean(fieldError('verdict'))}
							class="mt-2 w-full rounded-xl border border-line bg-panel px-3 py-3 text-sm text-slate-100"
						>
							<option value="">Choose one</option><option
								value="yes"
								selected={form?.values?.verdict === 'yes'}>Yes — the game works</option
							><option value="no" selected={form?.values?.verdict === 'no'}
								>No — the game does not work</option
							>
						</select>
						{#if fieldError('verdict')}<p class="mt-1 text-xs text-rose-200">
								{fieldError('verdict')}
							</p>{/if}
					</div>
					<div>
						<label for="deviceId" class="block text-sm font-semibold text-white"
							>Which device did you play on? <span class="text-mint">*</span></label
						>
						<select
							id="deviceId"
							name="deviceId"
							bind:value={selectedDeviceId}
							required
							aria-invalid={Boolean(fieldError('deviceId'))}
							class="mt-2 w-full rounded-xl border border-line bg-panel px-3 py-3 text-sm text-slate-100"
						>
							{#each data.devices as device (device.id)}<option value={device.id}
									>{device.name}{device.gpu ? ` — ${device.gpu}` : ''}</option
								>{/each}
						</select>
						{#if fieldError('deviceId')}<p class="mt-1 text-xs text-rose-200">
								{fieldError('deviceId')}
							</p>{/if}
					</div>
				</div>
				{#if selectedDevice}
					<div class="-mt-4 rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
						<p class="text-xs font-semibold text-slate-300">
							{selectedDevice.name} · {selectedDevice.deviceType === 'steam_deck'
								? 'Steam Deck'
								: 'Linux desktop'}
						</p>
						<p class="mt-1 text-xs leading-5 text-muted">
							{[
								selectedDevice.cpu,
								selectedDevice.gpu,
								selectedDevice.ram,
								selectedDevice.distribution,
								selectedDevice.kernel ? `Kernel ${selectedDevice.kernel}` : null,
								selectedDevice.graphicsDriver
							]
								.filter(Boolean)
								.join(' · ') || 'No hardware details are available for this device yet.'}
						</p>
					</div>
				{/if}

				<div>
					<label for="content" class="block text-sm font-semibold text-white"
						>Your experience <span class="text-mint">*</span></label
					>
					<textarea
						id="content"
						name="content"
						required
						minlength="10"
						maxlength={nativeReportLimits.content}
						rows="6"
						aria-invalid={Boolean(fieldError('content'))}
						class="mt-2 w-full resize-y rounded-xl border border-line bg-panel px-3 py-3 text-sm leading-6 text-slate-100 placeholder:text-slate-500"
						placeholder="Describe performance, crashes, graphical problems, controller support, workarounds, or anything other Linux players should know."
						>{form?.values?.content ?? ''}</textarea
					>
					{#if fieldError('content')}<p class="mt-1 text-xs text-rose-200">
							{fieldError('content')}
						</p>{/if}
				</div>

				<fieldset class="rounded-2xl border border-white/[0.07] p-4 sm:p-5">
					<legend class="px-2 text-sm font-bold text-white">Proton and launch details</legend>
					<div class="grid gap-4 sm:grid-cols-2">
						{#each [['protonVersion', 'Proton version', 'e.g. 9.0-4'], ['protonVariant', 'Proton variant', 'Valve Proton, Experimental, GE-Proton'], ['customProtonVersion', 'Custom Proton version', 'e.g. GE-Proton 9-20']] as [name, label, placeholder]}
							<div>
								<label for={name} class="block text-xs font-semibold text-slate-300"
									>{label}<input
										id={name}
										{name}
										maxlength={nativeReportLimits[name as keyof typeof nativeReportLimits]}
										value={form?.values?.[name] ?? ''}
										{placeholder}
										class="mt-1.5 w-full rounded-xl border border-line bg-panel px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500"
									/></label
								>{#if fieldError(name)}<p class="mt-1 text-xs text-rose-200">
										{fieldError(name)}
									</p>{/if}
							</div>
						{/each}
						<div>
							<label for="launchOptions" class="block text-xs font-semibold text-slate-300"
								>Steam launch options<input
									id="launchOptions"
									name="launchOptions"
									maxlength={nativeReportLimits.launchOptions}
									value={form?.values?.launchOptions ?? ''}
									placeholder="e.g. PROTON_LOG=1 %command%"
									class="mt-1.5 w-full rounded-xl border border-line bg-panel px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500"
								/></label
							>{#if fieldError('launchOptions')}<p class="mt-1 text-xs text-rose-200">
									{fieldError('launchOptions')}
								</p>{/if}
						</div>
					</div>
				</fieldset>

				<div class="grid gap-4 sm:grid-cols-2">
					<div>
						<label for="performanceNotes" class="block text-sm font-semibold text-white"
							>Performance notes <span class="font-normal text-muted">(optional)</span><textarea
								id="performanceNotes"
								name="performanceNotes"
								maxlength={nativeReportLimits.performanceNotes}
								rows="3"
								class="mt-2 w-full rounded-xl border border-line bg-panel px-3 py-3 text-sm text-slate-100 placeholder:text-slate-500"
								placeholder="Frame rate, resolution, battery life, or settings used."
								>{form?.values?.performanceNotes ?? ''}</textarea
							></label
						>{#if fieldError('performanceNotes')}<p class="mt-1 text-xs text-rose-200">
								{fieldError('performanceNotes')}
							</p>{/if}
					</div>
					<div>
						<label for="knownIssues" class="block text-sm font-semibold text-white"
							>Known issues <span class="font-normal text-muted">(optional)</span><textarea
								id="knownIssues"
								name="knownIssues"
								maxlength={nativeReportLimits.knownIssues}
								rows="3"
								class="mt-2 w-full rounded-xl border border-line bg-panel px-3 py-3 text-sm text-slate-100 placeholder:text-slate-500"
								placeholder="Crashes, graphical glitches, or needed workarounds."
								>{form?.values?.knownIssues ?? ''}</textarea
							></label
						>{#if fieldError('knownIssues')}<p class="mt-1 text-xs text-rose-200">
								{fieldError('knownIssues')}
							</p>{/if}
					</div>
				</div>

				<p class="text-xs leading-5 text-muted">
					Reports are private until reviewed. Do not include personal information. Plain text only;
					HTML is not accepted.
				</p>
				<button
					disabled={submitting}
					aria-busy={submitting}
					class="w-full rounded-xl bg-mint px-5 py-3.5 text-sm font-extrabold text-ink transition hover:bg-lime disabled:cursor-wait disabled:opacity-60 sm:w-auto"
					>{submitting ? 'Submitting…' : 'Submit report'}</button
				>
			</form>
		{/if}
	</div>
</section>
