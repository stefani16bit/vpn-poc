import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

import { FALLBACK_LOCALE, type SupportedLocale } from '@vpn/contracts';
import { negotiateLocale } from '@vpn/i18n';

import { AMBIENT_MODULE, type ApiModule, moduleForUrl } from './api-module.js';

export interface RequestContext {
	readonly correlationId: string;
	readonly locale: SupportedLocale;
	readonly module: ApiModule;
	// Who is calling, as far as the transport can tell, and which tenant the
	// address resolves to. Both are for the rate limiter, and neither is trusted
	// for authorization.
	readonly ip: string | null;
	readonly tenant: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const CORRELATION_HEADER = 'x-correlation-id';
export const CONTENT_LANGUAGE_HEADER = 'content-language';

export function currentContext(): RequestContext | undefined {
	return storage.getStore();
}

export function currentCorrelationId(): string | undefined {
	return storage.getStore()?.correlationId;
}

export function currentLocale(): SupportedLocale {
	return storage.getStore()?.locale ?? FALLBACK_LOCALE;
}

export function currentModule(): ApiModule {
	return storage.getStore()?.module ?? AMBIENT_MODULE;
}

export function currentIp(): string | null {
	return storage.getStore()?.ip ?? null;
}

export function currentTenant(): string | null {
	return storage.getStore()?.tenant ?? null;
}

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
	return storage.run(context, fn);
}

export function runWithCorrelation<T>(correlationId: string, fn: () => T): T {
	return storage.run(
		{ correlationId, locale: FALLBACK_LOCALE, module: AMBIENT_MODULE, ip: null, tenant: null },
		fn,
	);
}

// The slug of `acme.vpn.example.com`, and nothing for a bare host. It is a hint
// for bucketing a rate limit, never an authorization input — resolving the
// account for real is the job of the request that carries a session.
export function tenantOfHost(host: string | undefined): string | null {
	if (!host) return null;

	const name = host.split(':')[0] ?? '';
	const labels = name.split('.');
	if (labels.length < 3) return null;

	const first = labels[0];
	return first && first !== 'www' ? first : null;
}

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
	const incoming = req.headers[CORRELATION_HEADER];
	const correlationId =
		typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();

	const locale = negotiateLocale(req.headers['accept-language']);

	res.setHeader(CORRELATION_HEADER, correlationId);
	res.setHeader(CONTENT_LANGUAGE_HEADER, locale);

	runWithContext(
		{
			correlationId,
			locale,
			module: moduleForUrl(req.url),
			ip: req.ip ?? null,
			tenant: tenantOfHost(req.headers.host),
		},
		() => next(),
	);
}
