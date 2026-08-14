import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const kernel = join(here, '..', '..', 'api', 'src');

const main = readFileSync(join(here, 'main.ts'), 'utf8');
const barrel = readFileSync(join(kernel, 'worker.ts'), 'utf8');

function sourcesUnder(directory: string): readonly string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return sourcesUnder(path);

		return entry.name.endsWith('.ts') && !entry.name.includes('.spec.') ? [path] : [];
	});
}

// A sweep owns its own window in the cache and answers "is it my turn?" — which
// is what makes it something the loop may ask on every turn. Anything with that
// method is meant to be driven from here.
function sweepersInKernel(): readonly string[] {
	const found = new Set<string>();

	for (const path of sourcesUnder(kernel)) {
		const source = readFileSync(path, 'utf8');
		const due = source.indexOf('async runIfDue(');
		if (due < 0) continue;

		const declarations = [...source.slice(0, due).matchAll(/export class (\w+)/g)];
		const name = declarations.at(-1)?.[1];
		if (name) found.add(name);
	}

	return [...found].sort();
}

describe('the worker loop', () => {
	const sweepers = sweepersInKernel();

	it('finds the sweeps it is supposed to be driving', () => {
		expect(sweepers.length).toBeGreaterThan(0);
	});

	it.each(sweepers)('reexports %s from the worker entry point', (sweeper) => {
		expect(barrel).toContain(`export { ${sweeper} }`);
	});

	it.each(sweepers)('resolves %s out of the container', (sweeper) => {
		expect(main).toContain(`context.get(${sweeper})`);
	});

	it('asks every one of them whether it is due, and asks nothing twice', () => {
		expect(main.split('.runIfDue()').length - 1).toBe(sweepers.length);
	});
});
