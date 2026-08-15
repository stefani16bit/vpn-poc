import type { Provider } from '@nestjs/common';

import type { Env } from '@vpn-poc/env';

export interface AdapterDeps {
	readonly env: Env;
	readonly resolve: <T>(token: symbol) => T;
}

// Promise-returning because an adapter may need a secret before it can be
// built, and a secret is a round trip. Nest awaits a useFactory, so the
// difference stays inside this file.
export type AdapterFactory<T> = (deps: AdapterDeps) => T | Promise<T>;

export interface AdapterSpec<T> {
	readonly token: symbol;
	readonly driver: (env: Env) => string;
	readonly inject?: readonly symbol[];
	readonly drivers: Readonly<Record<string, AdapterFactory<T>>>;
}

export function defineAdapter<T>(spec: AdapterSpec<T>): AdapterSpec<T> {
	return spec;
}

export function toProviders(
	specs: readonly AdapterSpec<unknown>[],
	envToken: symbol | string,
): Provider[] {
	return specs.map((spec) => ({
		provide: spec.token,
		inject: [envToken, ...(spec.inject ?? [])],
		useFactory: (env: Env, ...resolved: unknown[]) => {
			const byToken = new Map<symbol, unknown>(
				(spec.inject ?? []).map((token, index) => [token, resolved[index]]),
			);

			const name = spec.driver(env);
			const factory = spec.drivers[name];
			if (!factory) {
				throw new Error(
					`no adapter registered for driver "${name}"; known drivers: ${Object.keys(spec.drivers).join(', ')}`,
				);
			}

			return factory({
				env,
				resolve: <U>(token: symbol) => byToken.get(token) as U,
			});
		},
	}));
}

export function tokensOf(specs: readonly AdapterSpec<unknown>[]): symbol[] {
	return specs.map((spec) => spec.token);
}
