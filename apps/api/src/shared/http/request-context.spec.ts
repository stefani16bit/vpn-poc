import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { FALLBACK_LOCALE } from '@vpn/contracts';

import {
	CONTENT_LANGUAGE_HEADER,
	CORRELATION_HEADER,
	currentContext,
	currentCorrelationId,
	currentLocale,
	requestContextMiddleware,
} from './request-context.js';

function run(headers: Record<string, string | undefined>): {
	setHeader: ReturnType<typeof vi.fn>;
	seen: { correlationId: string | undefined; locale: string | undefined };
} {
	const setHeader = vi.fn();
	const seen: { correlationId: string | undefined; locale: string | undefined } = {
		correlationId: undefined,
		locale: undefined,
	};
	const next: NextFunction = () => {
		seen.correlationId = currentCorrelationId();
		seen.locale = currentLocale();
	};

	requestContextMiddleware(
		{ headers } as unknown as Request,
		{ setHeader } as unknown as Response,
		next,
	);

	return { setHeader, seen };
}

describe('request context', () => {
	it('reports no context outside a request', () => {
		expect(currentContext()).toBeUndefined();
		expect(currentCorrelationId()).toBeUndefined();
	});

	it('falls back to the fallback locale outside a request', () => {
		expect(currentLocale()).toBe(FALLBACK_LOCALE);
	});

	it('keeps an incoming correlation id so one id spans the whole call chain', () => {
		const { seen, setHeader } = run({ [CORRELATION_HEADER]: 'given-id' });

		expect(seen.correlationId).toBe('given-id');
		expect(setHeader).toHaveBeenCalledWith(CORRELATION_HEADER, 'given-id');
	});

	it('mints a correlation id when the caller sent none', () => {
		const { seen } = run({});
		expect(seen.correlationId).toMatch(/^[0-9a-f-]{36}$/);
	});

	it('mints one rather than trusting an empty header', () => {
		const { seen } = run({ [CORRELATION_HEADER]: '' });
		expect(seen.correlationId).not.toBe('');
	});

	it('negotiates the locale from Accept-Language', () => {
		const { seen } = run({ 'accept-language': 'en-GB;q=0.9' });
		expect(seen.locale).toBe('en');
	});

	it('falls back when Accept-Language asks for something unsupported', () => {
		const { seen } = run({ 'accept-language': 'kl-GL' });
		expect(seen.locale).toBe(FALLBACK_LOCALE);
	});

	it('echoes the chosen locale back as content-language', () => {
		const { setHeader } = run({ 'accept-language': 'en' });
		expect(setHeader).toHaveBeenCalledWith(CONTENT_LANGUAGE_HEADER, 'en');
	});

	it('does not leak the context past the request', () => {
		run({ 'accept-language': 'en' });
		expect(currentContext()).toBeUndefined();
	});
});
