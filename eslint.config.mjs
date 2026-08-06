import js from '@eslint/js';
import globals from 'globals';
import nx from '@nx/eslint-plugin';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import betterTailwindcss from 'eslint-plugin-better-tailwindcss';
import { createNodeResolver, importX } from 'eslint-plugin-import-x';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default [
	{
		ignores: [
			'**/node_modules/**',
			'**/dist/**',
			'**/.nx/**',
			'**/coverage/**',
			'**/cdk.out/**',
			'packages/**',
		],
	},

	js.configs.recommended,
	...tseslint.configs.recommended,

	{
		plugins: { '@nx': nx },
		rules: {
			'@nx/enforce-module-boundaries': [
				'error',
				{
					enforceBuildableLibDependency: false,
					allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?js$'],
					depConstraints: [
						{
							sourceTag: 'type:deployment',
							onlyDependOnLibsWithTags: ['type:app', 'type:lib', 'type:adapter'],
						},
						{
							sourceTag: 'type:app',
							onlyDependOnLibsWithTags: ['type:lib', 'type:adapter'],
						},
						{
							sourceTag: 'type:adapter',
							onlyDependOnLibsWithTags: ['type:lib'],
						},
						{
							sourceTag: 'type:lib',
							onlyDependOnLibsWithTags: ['type:lib'],
						},
						{
							sourceTag: 'type:infra',
							onlyDependOnLibsWithTags: [],
						},
					],
				},
			],
		},
	},

	{
		files: ['apps/api/src/**/*.ts'],
		plugins: { 'import-x': importX },
		settings: {
			'import-x/resolver-next': [
				createTypeScriptImportResolver({ project: ['apps/api/tsconfig.json'] }),
				createNodeResolver(),
			],
		},
		rules: {
			'import-x/no-restricted-paths': [
				'error',
				{
					basePath: import.meta.dirname,
					zones: [
						{
							target: './apps/api/src/shared',
							from: './apps/api/src/modules',
							message:
								'shared/ is the kernel: every module may depend on it, and it may depend on no module.',
						},
						{
							target: './apps/api/src/modules/auth/**',
							from: './apps/api/src/modules/billing/**',
							message:
								'A module never reaches into another module. Move what is shared into shared/.',
						},
						{
							target: './apps/api/src/modules/billing/**',
							from: './apps/api/src/modules/auth/**',
							message:
								'A module never reaches into another module. Move what is shared into shared/.',
						},
						{
							target: './apps/api/src/modules/*/controllers/**',
							from: './apps/api/src/modules/*/repositories/**',
							message:
								'A controller validates, calls a service and formats. Persistence is the service business.',
						},
					],
				},
			],
		},
	},

	{
		files: ['apps/web/src/**/*.tsx'],
		...jsxA11y.flatConfigs.recommended,
	},

	{
		files: ['apps/web/src/**/*.{ts,tsx}'],
		plugins: { 'react-hooks': reactHooks },
		// The two classic rules only. The rest of v7's recommended set is the
		// React Compiler lint, which is a separate decision from this work.
		rules: {
			'react-hooks/rules-of-hooks': 'error',
			'react-hooks/exhaustive-deps': 'error',
		},
	},

	{
		files: ['apps/web/src/**/*.tsx'],
		plugins: { 'better-tailwindcss': betterTailwindcss },
		settings: {
			'better-tailwindcss': {
				entryPoint: 'apps/web/src/styles.css',
				callees: ['cn', 'cva', 'twMerge'],
				attributes: ['class', 'className'],
			},
		},
		rules: {
			'better-tailwindcss/enforce-consistent-class-order': 'error',
			'better-tailwindcss/no-duplicate-classes': 'error',
			'better-tailwindcss/no-conflicting-classes': 'error',
			// The legacy stylesheet is gone, so every class in a className is now either
			// a Tailwind utility or a typo.
			'better-tailwindcss/no-unknown-classes': 'error',
			'better-tailwindcss/enforce-consistent-line-wrapping': 'off',
		},
	},

	{
		files: ['apps/web/src/**/*.{ts,tsx}'],
		plugins: { 'import-x': importX },
		settings: {
			'import-x/resolver-next': [
				createTypeScriptImportResolver({ project: ['apps/web/tsconfig.json'] }),
				createNodeResolver(),
			],
		},
		rules: {
			'import-x/no-restricted-paths': [
				'error',
				{
					basePath: import.meta.dirname,
					zones: [
						{
							target: './apps/web/src/components',
							from: './apps/web/src/features',
							message: 'A shared component may not know a feature exists.',
						},
						{
							target: './apps/web/src/components/ui',
							from: './apps/web/src/app',
							message: 'components/ui is vendored: it may import lib/ and nothing else of ours.',
						},
						{
							target: './apps/web/src/features/auth/**',
							from: './apps/web/src/features/billing/**',
							message: 'Features do not import each other. Lift what is shared into components/.',
						},
						{
							target: './apps/web/src/features/billing/**',
							from: './apps/web/src/features/auth/**',
							message: 'Features do not import each other. Lift what is shared into components/.',
						},
					],
				},
			],
		},
	},

	{
		files: ['**/*.ts', '**/*.tsx', '**/*.mts'],
		rules: {
			'no-console': ['error', { allow: ['warn', 'error'] }],
			'@typescript-eslint/no-explicit-any': 'error',
			'@typescript-eslint/consistent-type-imports': [
				'error',
				{ prefer: 'type-imports', fixStyle: 'separate-type-imports' },
			],
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
			],
		},
	},

	{
		files: ['apps/api/src/**/*.ts', 'apps/api-lambda/src/**/*.ts', 'libs/adapters/src/**/*.ts'],
		rules: { '@typescript-eslint/consistent-type-imports': 'off' },
	},

	{
		files: ['**/*.mjs', '**/*.cjs', '**/*.config.*'],
		languageOptions: { globals: { ...globals.node } },
		rules: { 'no-undef': 'off' },
	},

	{
		files: ['apps/web/src/lib/logger.ts'],
		rules: { 'no-console': ['error', { allow: ['info', 'warn', 'error'] }] },
	},

	{
		files: ['**/*.spec.ts', '**/*.spec.tsx', '**/*.integration.spec.ts', '**/*.e2e.spec.ts'],
		rules: {
			'no-console': 'off',
			'@typescript-eslint/no-explicit-any': 'off',
		},
	},

	{
		files: ['**/main.ts', '**/main.tsx', '**/migrate.ts', 'infra/bin/*.ts', 'scripts/*.mjs'],
		rules: { 'no-console': 'off' },
	},
];
