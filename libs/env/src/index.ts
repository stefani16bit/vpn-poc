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

export function loadEnv(options: LoadEnvOptions = {}): Env {
	if (cached && !options.source) return cached;

	if (!options.skipDotenv && !options.source) {
		loadDotenv({ path: '.env.local', override: false });
		loadDotenv({ path: '.env', override: false });
	}

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
