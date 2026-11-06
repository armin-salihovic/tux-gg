<script lang="ts">
	import type { ActionData, PageData } from './$types';
	import DeviceEditor from '#lib/components/DeviceEditor.svelte';
	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head
	><title>Edit {data.device.name} | TuxGG</title><meta
		name="robots"
		content="noindex,follow"
	/></svelte:head
>
{#if !data.device.sourceVerifiedAt}
	<div class="container-shell max-w-4xl pt-8">
		<p
			role="status"
			class="rounded-xl border border-amber-200/20 bg-amber-200/[0.06] p-4 text-sm leading-6 text-amber-50"
		>
			This saved device predates Steam System Information validation. Rename it below or reimport
			Steam System Information to use it in new reports.
		</p>
	</div>
{/if}
<DeviceEditor
	editing={true}
	returnTo={data.returnTo === '/settings/devices' ? '' : data.returnTo}
	initialValues={{
		name: data.device.name
	}}
	values={form?.values}
	formError={form?.formError}
/>
