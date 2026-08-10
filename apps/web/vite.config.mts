import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { createVitestConfig } from '@vpn/config';
import { defineConfig } from 'vitest/config';

const preset = createVitestConfig({
	environment: 'jsdom',
	setupFiles: ['./src/test-setup.ts'],
	coverageExclude: ['src/test-utils.tsx', 'src/components/ui/**'],
	thresholds: { lines: 97, functions: 95, branches: 92, statements: 96 },
});

export default defineConfig({
	// The dotenv files live at the workspace root; without this Vite looks in
	// apps/web, finds nothing, and VITE_API_URL silently falls back to '/api'.
	envDir: fileURLToPath(new URL('../..', import.meta.url)),
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
	},
	server: {
		port: 5173,
		// Must match WEB_ORIGIN and the host in VITE_API_URL: the refresh cookie
		// is SameSite=Lax, and localhost and 127.0.0.1 are two different sites.
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
