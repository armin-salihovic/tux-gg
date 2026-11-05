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
<DeviceEditor
	editing={true}
	returnTo="/settings/devices"
	initialValues={{
		name: data.device.name,
		deviceType: data.device.deviceType,
		cpu: data.device.cpu ?? '',
		gpu: data.device.gpu ?? '',
		gpuVendor: data.device.gpuVendor ?? '',
		ram: data.device.ram ?? '',
		distribution: data.device.distribution ?? '',
		kernel: data.device.kernel ?? '',
		graphicsDriver: data.device.graphicsDriver ?? '',
		gpuDriverDetail: data.device.gpuDriverDetail ?? ''
	}}
	values={form?.values}
	formError={form?.formError}
/>
