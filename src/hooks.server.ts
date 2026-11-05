import { building } from '$app/env';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { getAuth, isAuthConfigured } from '#lib/server/auth.js';
import { logAuthDiagnostic, logAuthRequestRejection } from '#lib/server/auth-diagnostics.js';
import { applyResponseCachePolicy } from '#lib/server/cache-policy.js';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = null;
	event.locals.session = null;
	const secure = (response: Response) => {
		response.headers.set('X-Content-Type-Options', 'nosniff');
		response.headers.set('X-Frame-Options', 'DENY');
		response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
		response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
		if (process.env.NODE_ENV === 'production')
			response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
		return response;
	};
	if (!isAuthConfigured()) {
		if (event.url.pathname.startsWith('/api/auth/')) {
			logAuthDiagnostic('environment configuration');
		}
		if (event.url.pathname.startsWith('/api/auth/')) {
			return secure(Response.json({ error: 'auth_not_configured' }, { status: 503 }));
		}
		return secure(applyResponseCachePolicy(await resolve(event), false, event.url.pathname));
	}

	let auth: ReturnType<typeof getAuth>;
	try {
		auth = getAuth();
	} catch (error) {
		logAuthDiagnostic('Better Auth initialization', error);
		if (event.url.pathname.startsWith('/api/auth/')) {
			return secure(Response.json({ error: 'auth_unavailable' }, { status: 503 }));
		}
		throw error;
	}
	try {
		if (!building) {
			const session = await auth.api.getSession({ headers: event.request.headers });
			if (session) {
				event.locals.user = {
					id: session.user.id,
					name: session.user.name,
					username: session.user.username,
					image: session.user.image ?? null
				};
				event.locals.session = {
					id: session.session.id,
					expiresAt: session.session.expiresAt
				};
			}
		}
	} catch (error) {
		logAuthDiagnostic('authentication session lookup', error);
		if (event.url.pathname.startsWith('/api/auth/')) {
			return secure(Response.json({ error: 'auth_unavailable' }, { status: 503 }));
		}
	}
	let response: Response;
	try {
		response = await svelteKitHandler({ event, resolve, auth, building });
	} catch (error) {
		logAuthDiagnostic('Better Auth request handler', error);
		if (event.url.pathname.startsWith('/api/auth/')) {
			return secure(Response.json({ error: 'auth_unavailable' }, { status: 503 }));
		}
		throw error;
	}
	if (event.url.pathname === '/api/auth/steam/login' && response.status >= 400) {
		logAuthRequestRejection(response.status);
	}
	return secure(applyResponseCachePolicy(response, Boolean(event.locals.user), event.url.pathname));
};
