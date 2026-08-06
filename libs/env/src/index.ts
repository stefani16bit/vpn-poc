import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { config as loadDotenv } from 'dotenv';
import type { z } from 'zod';

import {
	assertDriverConfiguration,
	authEnvSchema,
	billingEnvSchema,
	cacheEnvSchema,
	databaseEnvSchema,
	emailEnvSchema,
	observabilityEnvSchema,
	runtimeEnvSchema,
	smsEnvSchema,
	storageEnvSchema,
} from './concerns.js';

export * from './concerns.js';

const fullSchema = runtimeEnvSchema
	.merge(databaseEnvSchema)
	.merge(authEnvSchema)
	.merge(cacheEnvSchema)
	.merge(emailEnvSchema)
	.merge(smsEnvSchema)
	.merge(billingEnvSchema)
	.merge(storageEnvSchema)
	.merge(observabilityEnvSchema);

export type Env = z.infer<typeof fullSchema>;

let cached: Env | null = null;

export interface LoadEnvOptions {
	readonly skipDotenv?: boolean;
	readonly source?: Record<string, string | undefined>;
}

/**
 * The single .env.local lives at the repository root, but no app ever runs with
 * the root as its cwd - `pnpm --filter <pkg> dev` executes each script inside
 * its own package. Resolving from the cwd therefore reads nothing on a machine
 * set up exactly as documented, and the failure looks like a missing variable
 * rather than a file that was never opened.
 *
 * Falls back to the cwd when no marker is found, which is the deployed case:
 * there is no workspace and no dotenv file, and dotenv treats both as a no-op.
 */
function workspaceRoot(): string {
	let dir = process.cwd();
	for (;;) {
		if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
		const parent = dirname(dir);
		if (parent === dir) return process.cwd();
		dir = parent;
	}
}

export function loadWorkspaceDotenv(): void {
	const root = workspaceRoot();
	loadDotenv({ path: join(root, '.env.local'), override: false });
	loadDotenv({ path: join(root, '.env'), override: false });
}

export function loadEnv(options: LoadEnvOptions = {}): Env {
	if (cached && !options.source) return cached;

	if (!options.skipDotenv && !options.source) loadWorkspaceDotenv();

	const parsed = fullSchema.safeParse(options.source ?? process.env);
	if (!parsed.success) {
		const details = parsed.error.issues
			.map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
			.join('\n');
		throw new Error(`invalid environment configuration:\n${details}`);
	}

	assertDriverConfiguration(parsed.data);

	if (!options.source) cached = parsed.data;
	return parsed.data;
}

export function resetEnvCache(): void {
	cached = null;
}
