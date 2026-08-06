import type { Params } from 'nestjs-pino';
import type { PrettyOptions } from 'pino-pretty';

import { AMBIENT_MODULE, isApiModule } from './api-module.js';
import { createModuleFanout } from './module-fanout-stream.js';
import { CORRELATION_HEADER, currentContext } from './request-context.js';

export const REDACT_PATHS = [
	'req.headers.authorization',
	'req.headers.cookie',
	'res.headers["set-cookie"]',
	'req.headers["stripe-signature"]',
	'req.body.password',
	'req.body.newPassword',
	'req.body.token',
	'req.body.refreshToken',
	'*.password',
	'*.passwordHash',
	'*.token',
	'*.accessToken',
	'*.refreshToken',
	'*.resetToken',
	'*.code',
	'*.otp',
	'*.secret',
	'*.apiKey',
];

export const NDJSON_LOG_FILE = 'logs/api.ndjson';

export type LogTransport = 'pretty' | 'json' | 'file' | 'gelf' | 'loki';

export interface LoggerConfigOptions {
	readonly nodeEnv: string;
	readonly level: string;
	readonly version: string;
	readonly transport?: LogTransport | undefined;
	readonly transportUrl?: string | undefined;
}

export const PRETTY_OPTIONS: PrettyOptions = {
	colorize: true,
	singleLine: true,
	translateTime: 'HH:MM:ss',
	messageFormat: '{if module}({module}) {end}{if correlationId}[{correlationId}] {end}{msg}',
	ignore: 'pid,hostname,service,env,version,correlationId,locale,module',
};

export function contextProps(logger?: {
	bindings: () => Record<string, unknown>;
}): Record<string, unknown> {
	const context = currentContext();
	const bound = logger?.bindings().module;

	if (isApiModule(bound)) {
		return context === undefined
			? {}
			: { correlationId: context.correlationId, locale: context.locale };
	}

	return { ...context, module: context?.module ?? AMBIENT_MODULE };
}

function resolveTransport(options: LoggerConfigOptions): Params['pinoHttp'] {
	const selected = options.transport ?? (options.nodeEnv === 'development' ? 'pretty' : 'json');

	if (selected === 'gelf' || selected === 'loki') {
		const sink = options.transportUrl ?? '(no LOG_TRANSPORT_URL set)';
		console.warn(
			`LOG_TRANSPORT=${selected} is reserved but not wired yet; ${sink} will receive nothing and logs fall back to json on stdout.`,
		);
		return {};
	}

	if (selected === 'json') return {};
	if (selected === 'file') return { stream: createModuleFanout({ combined: NDJSON_LOG_FILE }) };

	return { stream: createModuleFanout({ combined: NDJSON_LOG_FILE, pretty: PRETTY_OPTIONS }) };
}

export function loggerConfig(options: LoggerConfigOptions): Params {
	return {
		pinoHttp: {
			level: options.level,
			base: { service: 'poc-vpn-api', env: options.nodeEnv, version: options.version },
			redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
			autoLogging: {
				ignore: (req) => req.url === '/health' || req.url === '/health/ready',
			},
			customLogLevel: (_req, res, error) => {
				if (error) return 'silent';
				if (res.statusCode >= 500) return 'silent';
				if (res.statusCode >= 400) return 'warn';
				return 'info';
			},
			customProps: () => contextProps(),
			mixin: (_merge, _level, logger) => contextProps(logger),
			customAttributeKeys: { req: 'request', res: 'response' },
			serializers: {
				req: (req: { method: string; url: string; headers: Record<string, unknown> }) => ({
					method: req.method,
					url: req.url,
					correlationId: req.headers[CORRELATION_HEADER],
				}),
			},
			...resolveTransport(options),
		},
	};
}
