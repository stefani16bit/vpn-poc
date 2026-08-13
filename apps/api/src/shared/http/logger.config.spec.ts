import type { IncomingMessage, ServerResponse } from 'node:http';

import { describe, expect, it, vi } from 'vitest';

import { NDJSON_LOG_FILE, PRETTY_OPTIONS, REDACT_PATHS, loggerConfig } from './logger.config.js';
import { moduleLogFile } from './module-fanout-stream.js';
import { runWithContext } from './request-context.js';

function configFor(nodeEnv: string, transport?: string): Record<string, unknown> {
	return loggerConfig({
		nodeEnv,
		level: 'info',
		version: '1.2.3',
		...(transport === undefined ? {} : { transport }),
	} as Parameters<typeof loggerConfig>[0]).pinoHttp as Record<string, unknown>;
}

type Mixin = (
	merge?: unknown,
	level?: unknown,
	logger?: { bindings: () => Record<string, unknown> },
) => Record<string, unknown>;

function mixinFor(nodeEnv: string): Mixin {
	return configFor(nodeEnv).mixin as Mixin;
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

	it('falls back to pretty in development and json everywhere else', () => {
		expect(configFor('development')).toHaveProperty('stream');
		expect(configFor('production')).not.toHaveProperty('stream');
	});

	it('lets the transport override the environment in both directions', () => {
		expect(configFor('development', 'json')).not.toHaveProperty('stream');
		expect(configFor('production', 'pretty')).toHaveProperty('stream');
	});

	it('fans the ndjson out per module so one module can be tailed on its own', () => {
		for (const transport of ['pretty', 'file']) {
			expect(configFor('development', transport)).toHaveProperty('stream');
			expect(configFor('development', transport)).not.toHaveProperty('transport');
		}

		expect(moduleLogFile(NDJSON_LOG_FILE, 'auth')).toBe('logs/api.auth.ndjson');
	});

	it('leads the pretty line with the module and the correlation id', () => {
		expect(PRETTY_OPTIONS.messageFormat).toContain('{module}');
		expect(PRETTY_OPTIONS.messageFormat).toContain('{correlationId}');
		expect(PRETTY_OPTIONS.ignore).toContain('module');
	});

	it('spawns no transport worker and no stream under json, because Lambda has no file', () => {
		expect(configFor('production', 'json')).not.toHaveProperty('transport');
		expect(configFor('production', 'json')).not.toHaveProperty('stream');
	});

	it('falls back to json and says so when a sink is named but not wired yet', () => {
		for (const transport of ['gelf', 'loki']) {
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

			expect(configFor('production', transport)).not.toHaveProperty('transport');
			expect(configFor('production', transport)).not.toHaveProperty('stream');
			expect(warn).toHaveBeenCalledWith(expect.stringContaining(transport));

			warn.mockRestore();
		}
	});

	it('redacts under every transport, not just the default one', () => {
		for (const transport of ['pretty', 'json', 'file', 'gelf', 'loki']) {
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

			expect(configFor('production', transport).redact).toEqual({
				paths: REDACT_PATHS,
				censor: '[REDACTED]',
			});

			warn.mockRestore();
		}
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
		const mixin = mixinFor('production');

		runWithContext(
			{ correlationId: 'corr-1', locale: 'en', module: 'billing', ip: null, tenant: null },
			() => {
				expect(mixin()).toMatchObject({
					correlationId: 'corr-1',
					locale: 'en',
					module: 'billing',
				});
			},
		);
	});

	it('attributes a line with no request to system', () => {
		expect(mixinFor('production')()).toEqual({ module: 'system' });
	});

	it('defers to the emitting module rather than the route it arrived on', () => {
		const mixin = mixinFor('production');
		const bound = { bindings: () => ({ module: 'auth' }) };

		runWithContext(
			{ correlationId: 'corr-1', locale: 'en', module: 'billing', ip: null, tenant: null },
			() => {
				expect(mixin(undefined, undefined, bound)).toEqual({
					correlationId: 'corr-1',
					locale: 'en',
				});
			},
		);
	});

	it('attributes the request itself, since pino-http logs it with no binding', () => {
		const customProps = configFor('production').customProps as () => Record<string, unknown>;

		runWithContext(
			{ correlationId: 'corr-1', locale: 'en', module: 'auth', ip: null, tenant: null },
			() => {
				expect(customProps()).toMatchObject({ module: 'auth' });
			},
		);
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
