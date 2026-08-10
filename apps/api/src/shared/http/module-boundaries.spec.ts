import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import eslintConfig from '../../../../../eslint.config.mjs';

interface Zone {
	readonly target: string;
	readonly from: string;
}

interface RestrictedPathsOptions {
	readonly zones: readonly Zone[];
}

function zonesFor(glob: string): readonly Zone[] {
	const entry = eslintConfig.find(
		(candidate) =>
			candidate.files?.includes(glob) === true &&
			candidate.rules?.['import-x/no-restricted-paths'] !== undefined,
	);

	const rule = entry?.rules?.['import-x/no-restricted-paths'] as
		readonly [string, RestrictedPathsOptions] | undefined;

	return rule?.[1].zones ?? [];
}

function directoriesIn(path: string): readonly string[] {
	return readdirSync(join(import.meta.dirname, path), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
}

function pairsOf(names: readonly string[]): readonly (readonly [string, string])[] {
	return names.flatMap((target) =>
		names.filter((from) => from !== target).map((from) => [target, from] as const),
	);
}

describe('module boundaries', () => {
	it('keeps a zone for every ordered pair of API modules', () => {
		const zones = zonesFor('apps/api/src/**/*.ts');

		for (const [target, from] of pairsOf(directoriesIn('../../modules'))) {
			expect(zones).toContainEqual(
				expect.objectContaining({
					target: `./apps/api/src/modules/${target}/**`,
					from: `./apps/api/src/modules/${from}/**`,
				}),
			);
		}
	});

	it('keeps a zone for every ordered pair of web features', () => {
		const zones = zonesFor('apps/web/src/**/*.{ts,tsx}');

		for (const [target, from] of pairsOf(directoriesIn('../../../../web/src/features'))) {
			expect(zones).toContainEqual(
				expect.objectContaining({
					target: `./apps/web/src/features/${target}/**`,
					from: `./apps/web/src/features/${from}/**`,
				}),
			);
		}
	});

	it('keeps the kernel out of reach of every module', () => {
		expect(zonesFor('apps/api/src/**/*.ts')).toContainEqual(
			expect.objectContaining({
				target: './apps/api/src/shared',
				from: './apps/api/src/modules',
			}),
		);
	});
});
