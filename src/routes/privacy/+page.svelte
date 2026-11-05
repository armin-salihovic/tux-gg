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
			title: 'Imported community reports',
			paragraphs: [
				'Imported ProtonDB reports can contain hardware descriptions, launch options, and free-text notes. The source exports do not provide report-author IDs. The importer removes email-shaped strings from displayable text, but this is a limited safeguard and may not detect every personal detail. Do not rely on it as complete anonymization.'
			]
		},
		{
			title: 'TuxGG community reports',
			paragraphs: [
				'If you submit a native report, TuxGG stores the compatibility verdict, platform, optional technical details, report text, and your account ID. It remains visible only in your My Reports page until an operator publishes it. A published report displays your public username and submitted report details on the game page. Do not include personal information.'
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
