<script lang="ts">
	import ContentPage from '#lib/components/ContentPage.svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
	const sections = [
		{
			title: 'Account information',
			paragraphs: [
				'If you sign in with Discord, TuxGG stores the account information needed to create and maintain your profile, including a display name, username, profile image, and the private OAuth account/session records required for authentication. Your email address and OAuth tokens are not shown on public profiles.',
				'Discord sign-in requests identity and email scopes for account setup. A Discord account without a returned email uses a private placeholder address in the authentication database; that address is not displayed or used for email.'
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
