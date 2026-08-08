export const API_MODULES = ['auth', 'billing', 'entitlements', 'health', 'http', 'system'] as const;

export type ApiModule = (typeof API_MODULES)[number];

export const UNROUTED_MODULE: ApiModule = 'http';
export const AMBIENT_MODULE: ApiModule = 'system';

export const MODULE_BY_ROUTE_PREFIX: ReadonlyArray<readonly [string, ApiModule]> = [
	['/auth', 'auth'],
	['/billing', 'billing'],
	['/entitlements', 'entitlements'],
	['/health', 'health'],
];

export function isApiModule(value: unknown): value is ApiModule {
	return typeof value === 'string' && (API_MODULES as readonly string[]).includes(value);
}

export function moduleForUrl(url: string | undefined): ApiModule {
	if (url === undefined) return UNROUTED_MODULE;

	const path = url.split('?')[0] ?? '';

	for (const [prefix, module] of MODULE_BY_ROUTE_PREFIX) {
		if (path === prefix || path.startsWith(`${prefix}/`)) return module;
	}

	return UNROUTED_MODULE;
}
