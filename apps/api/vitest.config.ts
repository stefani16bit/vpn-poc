import { createVitestConfig } from '@vpn/config';
import { defineConfig } from 'vitest/config';

const preset = createVitestConfig({
	coverageExclude: [
		'src/**/*.module.ts',
		'src/**/repositories/**',
		'src/bootstrap.ts',
		'src/e2e.setup.ts',
	],
	thresholds: { lines: 94, functions: 87, branches: 88, statements: 93 },
});

export default defineConfig({
	test: {
		...preset.test,
		include: ['src/**/*.spec.ts'],
		exclude: ['src/**/*.e2e.spec.ts', 'src/**/*.integration.spec.ts'],
		coverage: {
			...preset.test.coverage,
			provider: 'v8' as const,
			// Without this, coverage counts only the files a test already imports,
			// which is how a 40% suite reported 90%.
			include: ['src/**/*.ts'],
		},
	},
});
