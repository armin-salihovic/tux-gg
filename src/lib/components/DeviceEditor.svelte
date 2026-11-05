<script lang="ts">
	import { untrack } from 'svelte';
	import {
		parseSteamSystemInfo,
		STEAM_SYSTEM_INFO_MAX_LENGTH,
		type DetectedSystemInfo,
		type SavedDeviceType
	} from '#lib/steam-system-info.js';

	type Values = {
		name: string;
		deviceType: SavedDeviceType;
		cpu: string;
		gpu: string;
		gpuVendor: string;
		ram: string;
		distribution: string;
		kernel: string;
		graphicsDriver: string;
		gpuDriverDetail: string;
	};
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
	const detailFields: Array<
		[Exclude<keyof Values, 'name' | 'deviceType' | 'gpuVendor'>, string, number]
	> = [
		['cpu', 'CPU', 160],
		['gpu', 'GPU', 160],
		['ram', 'RAM', 80],
		['distribution', 'Linux distribution or OS', 120],
		['kernel', 'Kernel version', 120],
		['graphicsDriver', 'Graphics driver', 120],
		['gpuDriverDetail', 'GPU driver detail', 120]
	];
	const applyDetected = () => {
		detectionError = '';
		const result = parseSteamSystemInfo(importText);
		if (!result.ok) {
			detected = null;
			detectionError = result.error;
			return;
		}
		detected = result.value;
		values.deviceType = result.value.deviceType;
		for (const field of [
			'cpu',
			'gpu',
			'gpuVendor',
			'ram',
			'distribution',
			'kernel',
			'graphicsDriver',
			'gpuDriverDetail'
		] as const) {
			const value = result.value[field];
			if (value !== null || !editing) values[field] = value ?? '';
		}
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
			Open Steam → Help → System Information, copy the information, and paste it here. The text is
			parsed in your browser and only the hardware details below are saved.
		</p>

		<div class="mt-6 space-y-4">
			<label for="systemInfo" class="block text-sm font-semibold text-white"
				>Steam System Information</label
			>
			<textarea
				id="systemInfo"
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
			<div class="mt-6 rounded-2xl border border-mint/20 bg-mint/[0.05] p-4 sm:p-5">
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div>
						<h2 class="font-bold text-white">Hardware detected</h2>
						<p class="mt-1 text-xs text-muted">Review and correct any value before saving.</p>
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
						Not detected: {detected.missingFields
							.map((field) => labels[field])
							.filter(Boolean)
							.join(', ')}. You can enter these details yourself or save a partial device.
					</p>{/if}
			</div>
		{/if}

		<form method="POST" action="?/save" class="mt-7 space-y-5">
			{#if !editing}<input type="hidden" name="returnTo" value={returnTo} />{/if}
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
			<label for="deviceType" class="block text-sm font-semibold text-slate-200"
				>Device type<select
					id="deviceType"
					name="deviceType"
					bind:value={values.deviceType}
					class="mt-2 block w-full rounded-xl border border-line bg-panel px-4 py-3 text-sm text-white"
					><option value="linux_desktop">Linux desktop</option><option value="steam_deck"
						>Steam Deck</option
					></select
				></label
			>
			<fieldset class="rounded-2xl border border-white/[0.07] p-4 sm:p-5">
				<legend class="px-2 text-sm font-bold text-white"
					>Detected details <span class="font-normal text-muted">(all optional and editable)</span
					></legend
				>
				<div class="grid gap-4 sm:grid-cols-2">
					{#each detailFields as [name, label, max]}
						<div>
							<label for={name} class="block text-xs font-semibold text-slate-300"
								>{label}<input
									id={name}
									{name}
									bind:value={values[name]}
									maxlength={max}
									class="mt-1.5 w-full rounded-xl border border-line bg-panel px-3 py-2.5 text-sm text-slate-100"
								/></label
							>
						</div>
					{/each}
					<div>
						<label for="gpuVendor" class="block text-xs font-semibold text-slate-300"
							>GPU vendor<select
								id="gpuVendor"
								name="gpuVendor"
								bind:value={values.gpuVendor}
								class="mt-1.5 w-full rounded-xl border border-line bg-panel px-3 py-2.5 text-sm text-slate-100"
								><option value="">Not detected</option
								>{#each ['AMD', 'NVIDIA', 'Intel', 'Apple', 'Multiple', 'Unknown'] as vendor}<option
										value={vendor}>{vendor}</option
									>{/each}</select
							></label
						>
					</div>
				</div>
			</fieldset>
			<div class="flex flex-wrap gap-3">
				<button class="rounded-xl bg-mint px-5 py-3 text-sm font-extrabold text-ink hover:bg-lime"
					>Save device</button
				><a
					class="rounded-xl border border-line px-5 py-3 text-sm font-semibold text-slate-200 hover:border-mint/40"
					href="/settings/devices">Cancel</a
				>
			</div>
		</form>
	</div>
</section>
