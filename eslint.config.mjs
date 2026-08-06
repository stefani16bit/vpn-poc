import js from '@eslint/js';
import globals from 'globals';
import nx from '@nx/eslint-plugin';
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
		files: [
			'apps/api/src/**/*.ts',
			'apps/api-lambda/src/**/*.ts',
			'libs/adapters/src/**/*.ts',
		],
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
