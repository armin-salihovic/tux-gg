<script lang="ts">
	import { untrack } from 'svelte';
	import {
		parseSteamSystemInfo,
		STEAM_SYSTEM_INFO_MAX_LENGTH,
		type DetectedSystemInfo
	} from '#lib/steam-system-info.js';

	type Values = { name: string };
	let {
		editing,
		returnTo,
		initialValues,
		values: submittedValues,
		formError
	}: {
		editing: boolean;
		returnTo: string;
		initialValues: Values;
		values?: Partial<Values>;
		formError?: string;
	} = $props();
	let values = $state<Values>(untrack(() => ({ ...initialValues, ...submittedValues })));
	let importText = $state('');
	let detected = $state<DetectedSystemInfo | null>(null);
	let detectedFor = $state('');
	let detectionError = $state('');
	let fileInput: HTMLInputElement;
	const labels: Record<string, string> = {
		cpu: 'CPU',
		gpu: 'GPU',
		gpuVendor: 'GPU vendor',
		ram: 'RAM',
		distribution: 'Distribution',
		kernel: 'Kernel',
		graphicsDriver: 'Graphics driver',
		gpuDriverDetail: 'GPU driver detail'
	};
	const saveDisabled = $derived(
		editing
			? Boolean(importText.trim()) && (!detected || detectedFor !== importText)
			: !detected || detectedFor !== importText
	);
	const applyDetected = () => {
		detectionError = '';
		detectedFor = '';
		const result = parseSteamSystemInfo(importText);
		if (!result.ok) {
			detected = null;
			detectionError = result.error;
			return;
		}
		detected = result.value;
		detectedFor = importText;
	};
	const readFile = async (event: Event) => {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		if (!file.name.toLowerCase().endsWith('.txt')) {
			detectionError = 'Choose a .txt file.';
			fileInput.value = '';
			return;
		}
		if (file.size > STEAM_SYSTEM_INFO_MAX_LENGTH) {
			detectionError = `The file must be ${STEAM_SYSTEM_INFO_MAX_LENGTH.toLocaleString()} characters or fewer.`;
			fileInput.value = '';
			return;
		}
		try {
			importText = await file.text();
			detectionError = '';
			detected = null;
			detectedFor = '';
		} catch {
			detectionError = 'This text file could not be read. Try pasting the contents instead.';
		}
	};
</script>

<section class="container-shell max-w-4xl py-10 sm:py-14">
	<a class="text-sm font-semibold text-mint hover:text-lime" href="/settings/devices"
		>← Your devices</a
	>
	<div class="surface mt-5 rounded-3xl p-5 sm:p-8">
		<p class="eyebrow">Account · Devices</p>
		<h1 class="mt-2 text-3xl font-black tracking-tight text-white">
			{editing ? 'Edit device' : 'Add a device'}
		</h1>
		<p class="mt-2 text-sm leading-6 text-muted">
			{#if editing}
				Change the friendly name, or import new Steam System Information to replace this device's
				hardware snapshot.
			{:else}
				Open Steam → Help → System Information, copy the information, and paste it here. Hardware
				must be detected from a supported Linux system or Steam Deck.
			{/if}
			The original text is sent for server validation, processed transiently, and never stored.
		</p>

		<form method="POST" action="?/save" class="mt-6 space-y-5">
			{#if returnTo}<input type="hidden" name="returnTo" value={returnTo} />{/if}
			{#if formError}<p
					role="alert"
					class="rounded-xl border border-rose-300/20 bg-rose-300/[0.06] p-3 text-sm text-rose-100"
				>
					{formError}
				</p>{/if}
			<label for="name" class="block text-sm font-semibold text-slate-200"
				>Device name<input
					id="name"
					name="name"
					bind:value={values.name}
					required
					maxlength="60"
					class="mt-2 block w-full rounded-xl border border-line bg-black/20 px-4 py-3 text-sm text-white"
				/></label
			>

			<div class="space-y-3">
				<label for="systemInfo" class="block text-sm font-semibold text-white"
					>{editing
						? 'Replace Steam System Information (optional)'
						: 'Steam System Information'}</label
				>
				<textarea
					id="systemInfo"
					name="systemInfo"
					bind:value={importText}
					rows="9"
					maxlength={STEAM_SYSTEM_INFO_MAX_LENGTH}
					class="w-full resize-y rounded-xl border border-line bg-black/20 px-4 py-3 font-mono text-xs leading-5 text-slate-100 placeholder:text-slate-500"
					placeholder="Paste Steam's System Information here…"></textarea>
				<div class="flex flex-wrap items-center gap-3">
					<input
						bind:this={fileInput}
						type="file"
						accept=".txt,text/plain"
						onchange={readFile}
						aria-label="Upload Steam System Information text file"
						class="max-w-full text-xs text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white"
					/>
					<button
						type="button"
						onclick={applyDetected}
						class="rounded-xl border border-mint/30 bg-mint/10 px-4 py-2.5 text-sm font-bold text-mint hover:bg-mint/15"
						>Detect System Information</button
					>
				</div>
				{#if detectionError}<p role="alert" class="text-sm text-rose-100">{detectionError}</p>{/if}
			</div>

			{#if detected}
				<div class="rounded-2xl border border-mint/20 bg-mint/[0.05] p-4 sm:p-5">
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div>
							<h2 class="font-bold text-white">Hardware detected</h2>
							<p class="mt-1 text-xs text-muted">These specifications are read-only.</p>
						</div>
						<span
							class="rounded-full border border-mint/25 px-2.5 py-1 text-xs font-semibold text-mint"
							>{detected.deviceType === 'steam_deck' ? 'Steam Deck' : 'Linux desktop'}</span
						>
					</div>
					<dl class="mt-4 grid gap-x-5 gap-y-3 text-sm sm:grid-cols-2">
						{#each Object.entries(labels) as [field, label]}
							<div>
								<dt class="text-xs text-slate-500">{label}</dt>
								<dd class="mt-0.5 text-slate-200">
									{detected[field as keyof DetectedSystemInfo] || 'Not detected'}
								</dd>
							</div>
						{/each}
					</dl>
					{#if detected.missingFields.length}<p class="mt-4 text-xs leading-5 text-slate-400">
							Some optional information was not present in the import: {detected.missingFields
								.map((field) => labels[field])
								.filter(Boolean)
								.join(', ')}.
						</p>{/if}
				</div>
			{/if}

			<div class="flex flex-wrap gap-3">
				<button
					disabled={saveDisabled}
					class="rounded-xl bg-mint px-5 py-3 text-sm font-extrabold text-ink hover:bg-lime disabled:cursor-not-allowed disabled:opacity-50"
					>Save device</button
				><a
					class="rounded-xl border border-line px-5 py-3 text-sm font-semibold text-slate-200 hover:border-mint/40"
					href="/settings/devices">Cancel</a
				>
			</div>
		</form>
	</div>
</section>
