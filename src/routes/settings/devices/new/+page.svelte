<script lang="ts">
	import type { ActionData, PageData } from './$types';
	import DeviceEditor from '#lib/components/DeviceEditor.svelte';
	let { data, form }: { data: PageData; form: ActionData } = $props();
	const initialValues = { name: '' };
</script>

<svelte:head
	><title>Add device | VapourDB</title><meta name="robots" content="noindex,follow" /></svelte:head
>
<DeviceEditor
	editing={false}
	returnTo={data.returnTo}
	{initialValues}
	values={form?.values}
	formError={form?.formError}
/>
