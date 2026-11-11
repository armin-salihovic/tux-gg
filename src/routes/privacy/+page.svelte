<script lang="ts">
	import ContentPage from '#lib/components/ContentPage.svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
	const sections = [
		{
			title: 'Account information',
			paragraphs: [
				'If you sign in through Steam OpenID, VapourDB stores your SteamID64, a display name, username, optional profile image, and the private account/session records required for authentication. Steam does not provide a verified email address. VapourDB uses a private placeholder address internally; it is not verified, displayed, or used for email or account linking.',
				'For service operation, an owner-authorized Steam account can view a private account overview with VapourDB usernames, display names, registration dates, and totals of reports submitted by each account. The totals include all moderation statuses; the overview does not show report text, email addresses, or authentication credentials.',
				'VapourDB may use an optional server-side Steam Web API key to retrieve public profile details. Steam authentication is verified separately through Steam OpenID.'
			]
		},
		{
			title: 'Cookies and service operation',
			paragraphs: [
				'VapourDB uses an authentication session cookie when you sign in. The app does not currently include advertising or analytics trackers. Server logs and hosting infrastructure may record ordinary request and error information according to the operator’s deployment configuration.'
			]
		},
		{
			title: 'VapourDB community reports',
			paragraphs: [
				'If you submit a report, VapourDB stores the compatibility verdict, platform, selected device snapshot, optional technical details, report text, and your account ID. Your report text, public username, and chosen device details appear on the game page immediately after submission. Operators may later hide or remove a report. Do not include personal information.'
			]
		},
		{
			title: 'Saved devices and Steam System Information',
			paragraphs: [
				'When you add or refresh a device, the Steam System Information text is sent to the server for validation and hardware parsing. Production VapourDB connections use HTTPS. The original text is processed transiently and is not stored in the database, application logs, or analytics. VapourDB stores the friendly device name and parsed specifications on your private device record.',
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
	intro="This notice summarizes the information handled by the current VapourDB implementation."
	{sections}
	canonical={data.canonical}
/>
