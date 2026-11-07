<script lang="ts">
	import ContentPage from '#lib/components/ContentPage.svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
	const sections = [
		{
			title: 'Account information',
			paragraphs: [
				'If you sign in through Steam OpenID, TuxGG stores your SteamID64, a display name, username, optional profile image, and the private account/session records required for authentication. Steam does not provide a verified email address. TuxGG uses a private placeholder address internally; it is not verified, displayed, or used for email or account linking.',
				'TuxGG may use an optional server-side Steam Web API key to retrieve public profile details. Steam authentication is verified separately through Steam OpenID.'
			]
		},
		{
			title: 'Cookies and service operation',
			paragraphs: [
				'TuxGG uses an authentication session cookie when you sign in. The app does not currently include advertising or analytics trackers. Server logs and hosting infrastructure may record ordinary request and error information according to the operator’s deployment configuration.'
			]
		},
		{
			title: 'TuxGG community reports',
			paragraphs: [
				'If you submit a report, TuxGG stores the compatibility verdict, platform, selected device snapshot, optional technical details, report text, and your account ID. It remains visible only in your My Reports page until an operator publishes it. A published report displays your public username and submitted report details on the game page. Do not include personal information.'
			]
		},
		{
			title: 'Saved devices and Steam System Information',
			paragraphs: [
				'When you add or refresh a device, the Steam System Information text is sent to the server for validation and hardware parsing. Production TuxGG connections use HTTPS. The original text is processed transiently and is not stored in the database, application logs, or analytics. TuxGG stores the friendly device name and parsed specifications on your private device record.',
				'Only Linux PCs and Steam Decks are accepted. Hardware specifications are read-only and can only be replaced with a new valid Steam import. A saved device must have validated import provenance to be used for a new report. Each report keeps a hardware snapshot; later device edits or deletion do not change historical reports. Parsing does not cryptographically verify or attest the hardware.'
			]
		},
		{
			title: 'Your choices and contact',
			paragraphs: [
				'You can update the public display name and username in account settings. For account deletion and privacy requests, use the contact channel shown on the Contact page. If no address appears there, the deployment owner has not configured one yet.'
			]
		},
		{
			title: 'Updates',
			paragraphs: [
				'This page describes the current implementation and should be updated whenever account handling, analytics, data sources, or hosting practices change.'
			]
		}
	];
</script>

<ContentPage
	eyebrow="Privacy"
	title="Privacy notice"
	intro="This notice summarizes the information handled by the current TuxGG implementation."
	{sections}
	canonical={data.canonical}
/>
