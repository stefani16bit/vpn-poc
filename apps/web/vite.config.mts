import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { createVitestConfig } from '@vpn/config';
import { defineConfig } from 'vitest/config';

const preset = createVitestConfig({
	environment: 'jsdom',
	setupFiles: ['./src/test-setup.ts'],
	coverageExclude: ['src/test-utils.tsx', 'src/components/ui/**'],
});

export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
	},
	server: {
		port: 5173,
		host: '127.0.0.1',
	},
	build: { sourcemap: true },
	test: {
		...preset.test,
		include: ['src/**/*.spec.{ts,tsx}'],
		// Request here is undici's, which rejects a relative URL; the app's own
		// default of '/api' makes every request fail before it reaches fetch.
		env: { VITE_API_URL: 'http://localhost/api' },
		coverage: {
			...preset.test.coverage,
			provider: 'v8' as const,
			// Without this, coverage counts only the files a test already imports,
			// which is how a 40% suite reported 90% on the API side.
			include: ['src/**/*.{ts,tsx}'],
		},
	},
});
