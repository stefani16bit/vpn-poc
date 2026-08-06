import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

import { FALLBACK_LOCALE, type SupportedLocale } from '@vpn/contracts';
import { negotiateLocale } from '@vpn/i18n';

export interface RequestContext {
	readonly correlationId: string;
	readonly locale: SupportedLocale;
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

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
	return storage.run(context, fn);
}

export function runWithCorrelation<T>(correlationId: string, fn: () => T): T {
	return storage.run({ correlationId, locale: FALLBACK_LOCALE }, fn);
}

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
	const incoming = req.headers[CORRELATION_HEADER];
	const correlationId =
		typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();

	const locale = negotiateLocale(req.headers['accept-language']);

	res.setHeader(CORRELATION_HEADER, correlationId);
	res.setHeader(CONTENT_LANGUAGE_HEADER, locale);

	runWithContext({ correlationId, locale }, () => next());
}
