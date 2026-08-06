import type { Params } from 'nestjs-pino';

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

export interface LoggerConfigOptions {
	readonly nodeEnv: string;
	readonly level: string;
	readonly version: string;
}

export function loggerConfig(options: LoggerConfigOptions): Params {
	const pretty = options.nodeEnv === 'development';

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
			customProps: () => ({ ...currentContext() }),
			mixin: () => ({ ...currentContext() }),
			customAttributeKeys: { req: 'request', res: 'response' },
			serializers: {
				req: (req: { method: string; url: string; headers: Record<string, unknown> }) => ({
					method: req.method,
					url: req.url,
					correlationId: req.headers[CORRELATION_HEADER],
				}),
			},
			...(pretty
				? {
						transport: {
							target: 'pino-pretty',
							options: { colorize: true, singleLine: true, translateTime: 'HH:MM:ss' },
						},
					}
				: {}),
		},
	};
}
