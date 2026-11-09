<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';
	import { MAX_USER_DEVICES } from '#lib/device-limits.js';
	import { formatGpuName } from '#lib/gpu-format.js';
	let { data, form }: { data: PageData; form: ActionData } = $props();
	const deviceTypeLabel = (type: string) =>
		type === 'steam_deck' ? 'Steam Deck' : 'Linux desktop';
	const summary = (device: PageData['devices'][number]) =>
		[formatGpuName(device.gpuVendor, device.gpu), device.cpu, device.ram, device.distribution]
			.filter(Boolean)
			.join(' · ');
</script>

<svelte:head
	><title>Devices | VapourDB</title><meta name="robots" content="noindex,follow" /></svelte:head
>

<section class="container-shell max-w-4xl py-10 sm:py-14">
	<a class="text-sm font-semibold text-mint hover:text-lime" href="/settings">← Account settings</a>
	<nav class="mt-5 flex flex-wrap gap-2" aria-label="Account settings">
		<a
			class="rounded-full border border-line px-4 py-2 text-sm text-slate-200 hover:border-mint/40"
			href="/settings">Profile</a
		>
		<span
			class="rounded-full bg-mint/10 px-4 py-2 text-sm font-semibold text-mint"
			aria-current="page">Devices</span
		>
		{#if data.isOwnerAdmin}<a
				class="rounded-full border border-line px-4 py-2 text-sm text-slate-200 hover:border-mint/40 hover:text-mint"
				href="/settings/users">Users</a
			>{/if}
	</nav>
	<div class="mt-6 flex flex-wrap items-end justify-between gap-4">
		<div>
			<p class="eyebrow">Account</p>
			<h1 class="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">Your devices</h1>
			<p class="mt-2 max-w-2xl text-sm leading-6 text-muted">
				Save Linux PCs and Steam Decks for your reports. Hardware comes from Steam System
				Information and stays read-only; you can choose the device name.
			</p>
		</div>
		{#if data.devices.length < MAX_USER_DEVICES}
			<a
				class="inline-flex rounded-xl bg-mint px-5 py-3 text-sm font-extrabold text-ink hover:bg-lime"
				href="/settings/devices/new">Add Device</a
			>
		{/if}
	</div>
	{#if data.saved}<p
			role="status"
			class="mt-6 rounded-xl border border-mint/20 bg-mint/[0.06] p-4 text-sm text-mint"
		>
			Device settings saved.
		</p>{/if}
	{#if form?.error}<p
			role="alert"
			class="mt-6 rounded-xl border border-rose-300/20 bg-rose-300/[0.06] p-4 text-sm text-rose-100"
		>
			{form.error}
		</p>{/if}
	{#if data.devices.length === 0}
		<div class="surface mt-7 rounded-2xl p-7 sm:p-10">
			<h2 class="text-lg font-bold text-white">No devices saved yet</h2>
			<p class="mt-2 max-w-xl text-sm leading-6 text-muted">
				Import Steam System Information to detect your CPU, GPU, memory, Linux distribution, kernel,
				and graphics driver. Only Linux PCs and Steam Decks are accepted.
			</p>
			<a
				class="mt-5 inline-flex rounded-xl bg-mint px-4 py-2.5 text-sm font-extrabold text-ink hover:bg-lime"
				href="/settings/devices/new">Add your first device</a
			>
		</div>
	{:else}
		<div class="mt-7 grid gap-4">
			{#each data.devices as device (device.id)}
				<article class="surface rounded-2xl p-5 sm:p-6">
					<div class="flex flex-wrap items-start justify-between gap-4">
						<div class="min-w-0">
							<div class="flex flex-wrap items-center gap-2">
								<h2 class="text-lg font-bold text-white">{device.name}</h2>
								{#if device.isDefault}<span
										class="rounded-full border border-mint/25 bg-mint/10 px-2.5 py-1 text-[0.68rem] font-bold text-mint"
										>Default device</span
									>{/if}
								{#if !device.sourceVerifiedAt}<span
										class="rounded-full border border-amber-200/20 bg-amber-200/[0.06] px-2.5 py-1 text-[0.68rem] font-bold text-amber-100"
										>Reimport required</span
									>{/if}
							</div>
							<p class="mt-1 text-xs text-muted">{deviceTypeLabel(device.deviceType)}</p>
							<p class="mt-3 text-sm leading-6 text-slate-300">
								{summary(device) || 'Hardware details not detected yet.'}
							</p>
							<dl class="mt-4 grid gap-x-5 gap-y-2 text-xs sm:grid-cols-2">
								{#each [['CPU', device.cpu], ['GPU', formatGpuName(device.gpuVendor, device.gpu)], ['RAM', device.ram], ['Distribution', device.distribution], ['Kernel', device.kernel], ['Graphics driver', [device.graphicsDriver, device.gpuDriverDetail]
											.filter(Boolean)
											.join(' · ')]] as [label, value]}
									<div>
										<dt class="text-slate-500">{label}</dt>
										<dd class="mt-0.5 text-slate-200">{value || 'Not detected'}</dd>
									</div>
								{/each}
							</dl>
						</div>
						<div class="flex flex-wrap gap-2">
							<a
								class="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-slate-200 hover:border-mint/40 hover:text-mint"
								href={`/settings/devices/${device.id}/edit`}
								>{device.sourceVerifiedAt ? 'Edit device' : 'Reimport Steam System Information'}</a
							>
							{#if !device.isDefault}
								<form method="POST" action="?/setDefault" use:enhance>
									<input type="hidden" name="id" value={device.id} />
									<button
										class="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-slate-200 hover:border-mint/40 hover:text-mint"
										>Set default</button
									>
								</form>
							{/if}
							<form
								method="POST"
								action="?/delete"
								use:enhance
								onsubmit={(event) => {
									if (
										!confirm(
											`Delete ${device.name}? Existing reports keep their saved hardware details.`
										)
									)
										event.preventDefault();
								}}
							>
								<input type="hidden" name="id" value={device.id} />
								<button
									class="rounded-lg border border-rose-200/15 px-3 py-2 text-xs font-semibold text-rose-100 hover:border-rose-200/35"
									>Delete</button
								>
							</form>
						</div>
					</div>
				</article>
			{/each}
		</div>
	{/if}
	<p class="mt-5 text-xs leading-5 text-muted">
		You can save up to {MAX_USER_DEVICES} devices. Steam text is sent to the server for validation, processed
		transiently, and not stored. Published reports keep their original hardware snapshots when a device
		is refreshed or deleted.
	</p>
</section>
