import type { IncomingMessage, ServerResponse } from 'node:http';

import { describe, expect, it } from 'vitest';

import { REDACT_PATHS, loggerConfig } from './logger.config.js';
import { runWithContext } from './request-context.js';

function configFor(nodeEnv: string): Record<string, unknown> {
	return loggerConfig({ nodeEnv, level: 'info', version: '1.2.3' }).pinoHttp as Record<
		string,
		unknown
	>;
}

describe('loggerConfig', () => {
	it('redacts every credential-bearing header and body field', () => {
		for (const path of [
			'req.headers.authorization',
			'req.headers.cookie',
			'req.headers["stripe-signature"]',
			'req.body.password',
			'*.accessToken',
			'*.refreshToken',
			'*.secret',
		]) {
			expect(REDACT_PATHS).toContain(path);
		}
	});

	it('stamps the service, environment and version onto every line', () => {
		expect(configFor('production').base).toEqual({
			service: 'poc-vpn-api',
			env: 'production',
			version: '1.2.3',
		});
	});

	it('pretty-prints only in development', () => {
		expect(configFor('development')).toHaveProperty('transport');
		expect(configFor('production')).not.toHaveProperty('transport');
	});

	it('keeps the health probes out of the log', () => {
		const ignore = configFor('production').autoLogging as { ignore: (req: unknown) => boolean };

		expect(ignore.ignore({ url: '/health' })).toBe(true);
		expect(ignore.ignore({ url: '/health/ready' })).toBe(true);
		expect(ignore.ignore({ url: '/auth/login' })).toBe(false);
	});

	it('leaves errors and 5xx to the exception filter instead of logging them twice', () => {
		const level = configFor('production').customLogLevel as (
			req: IncomingMessage,
			res: ServerResponse,
			error?: Error,
		) => string;
		const req = {} as IncomingMessage;

		expect(level(req, { statusCode: 200 } as ServerResponse, new Error('boom'))).toBe('silent');
		expect(level(req, { statusCode: 500 } as ServerResponse)).toBe('silent');
		expect(level(req, { statusCode: 404 } as ServerResponse)).toBe('warn');
		expect(level(req, { statusCode: 200 } as ServerResponse)).toBe('info');
	});

	it('mixes the request context into every line', () => {
		const mixin = configFor('production').mixin as () => Record<string, unknown>;

		runWithContext({ correlationId: 'corr-1', locale: 'en' }, () => {
			expect(mixin()).toMatchObject({ correlationId: 'corr-1', locale: 'en' });
		});
	});

	it('mixes in nothing outside a request', () => {
		const mixin = configFor('production').mixin as () => Record<string, unknown>;
		expect(mixin()).toEqual({});
	});

	it('serialises a request down to method, url and correlation id', () => {
		const serializers = configFor('production').serializers as {
			req: (req: unknown) => Record<string, unknown>;
		};

		expect(
			serializers.req({
				method: 'POST',
				url: '/auth/login',
				headers: { 'x-correlation-id': 'corr-1', authorization: 'Bearer secret' },
			}),
		).toEqual({ method: 'POST', url: '/auth/login', correlationId: 'corr-1' });
	});
});
