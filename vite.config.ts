import adapter from '@sveltejs/adapter-node';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			adapter: adapter()
		})
	],
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}', 'scripts/**/*.test.{js,ts}']
	}
});
