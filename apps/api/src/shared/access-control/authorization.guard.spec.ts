import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const modulesRoot = join(here, '..', '..', 'modules');

const ROUTE = /^@(Get|Post|Patch|Put|Delete)\(/;
const MUTATING = ['Post', 'Patch', 'Put', 'Delete'];

const GATES = [
	{ decorator: '@RequiresRole(', guard: 'RoleGuard' },
	{ decorator: '@RequiresCapability(', guard: 'CapabilityGuard' },
	{ decorator: '@RequiresPermission(', guard: 'PermissionGuard' },
] as const;

interface Exemption {
	readonly controller: string;
	readonly routes: 'all' | readonly string[];
	readonly why: string;
}

const UNGATED: readonly Exemption[] = [
	{
		controller: 'auth/controllers/auth.controller.ts',
		routes: 'all',
		why: 'unauthenticated, or self-service over the caller own row',
	},
	{
		controller: 'billing/controllers/billing.controller.ts',
		routes: ["@Post('webhook')"],
		why: 'the provider calls it, and the signature is what authenticates',
	},
];

interface Route {
	readonly controller: string;
	readonly route: string;
	readonly verb: string;
	readonly label: string;
	readonly decorators: string;
	readonly classDecorators: string;
}

function occurrences(text: string, character: string): number {
	return text.split(character).length - 1;
}

function decoratorsAbove(lines: readonly string[], classLine: number): string {
	const block: string[] = [];

	for (let index = classLine - 1; index >= 0 && lines[index] !== ''; index -= 1) {
		block.unshift(lines[index] ?? '');
	}

	return block.join('\n');
}

function decoratorsFrom(lines: readonly string[], start: number): string {
	const block: string[] = [];
	let depth = 0;

	for (let index = start; index < lines.length; index += 1) {
		const line = lines[index] ?? '';
		if (depth === 0 && !line.startsWith('@')) break;
		block.push(line);
		depth += occurrences(line, '(') - occurrences(line, ')');
	}

	return block.join('\n');
}

function routesIn(controller: string): Route[] {
	const lines = readFileSync(join(modulesRoot, controller), 'utf8')
		.split('\n')
		.map((line) => line.trim());

	const classDecorators = decoratorsAbove(
		lines,
		lines.findIndex((line) => line.startsWith('export class')),
	);

	return lines.flatMap((line, index) => {
		const verb = ROUTE.exec(line)?.[1];
		if (!verb) return [];

		return [
			{
				controller,
				route: line,
				verb,
				label: `${controller.split('/')[0] ?? controller} ${line}`,
				decorators: decoratorsFrom(lines, index),
				classDecorators,
			},
		];
	});
}

const controllers = readdirSync(modulesRoot, { recursive: true, encoding: 'utf8' })
	.map((entry) => entry.split('\\').join('/'))
	.filter((entry) => entry.endsWith('.controller.ts'))
	.sort();

const routes = controllers.flatMap(routesIn);

function exemptionFor(route: Route): Exemption | undefined {
	return UNGATED.find(
		(entry) =>
			entry.controller === route.controller &&
			(entry.routes === 'all' || entry.routes.includes(route.route)),
	);
}

function gatesOn(route: Route): string[] {
	return GATES.filter(
		(gate) =>
			route.decorators.includes(gate.decorator) || route.classDecorators.includes(gate.decorator),
	).map((gate) => gate.guard);
}

describe('authorization of every route under modules/', () => {
	const mustBeGated = routes
		.filter((route) => MUTATING.includes(route.verb))
		.filter((route) => !exemptionFor(route));

	const gated = routes.filter((route) => gatesOn(route).length > 0);

	it('reads more than one controller', () => {
		expect(controllers.length).toBeGreaterThan(1);
	});

	it('finds a mutating route to check', () => {
		expect(mustBeGated.length).toBeGreaterThan(0);
	});

	it.each(mustBeGated)('$label asks who is calling', (route) => {
		expect(
			gatesOn(route),
			`${route.controller} ${route.route} needs a gate decorator, or an entry in UNGATED saying why not`,
		).not.toEqual([]);
	});

	it.each(gated)('$label wires the guard its gate needs', (route) => {
		const wiring = `${route.classDecorators}\n${route.decorators}`;
		for (const guard of gatesOn(route)) {
			expect(
				wiring,
				`${route.controller} ${route.route} gates without @UseGuards(${guard}), which answers 500 instead of 403`,
			).toContain(guard);
		}
	});

	it.each(UNGATED)('the $controller exemption still names a route', (exemption) => {
		const matched = routes.filter(
			(route) =>
				route.controller === exemption.controller &&
				(exemption.routes === 'all' || exemption.routes.includes(route.route)),
		);

		expect(matched).not.toEqual([]);
	});
});
