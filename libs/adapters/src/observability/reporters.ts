import * as Sentry from '@sentry/node';

import type { ErrorContext, IErrorReporter } from '@vpn/ports';

export const SENSITIVE_KEYS = [
	'password',
	'passwordHash',
	'newPassword',
	'token',
	'accessToken',
	'refreshToken',
	'resetToken',
	'code',
	'otp',
	'secret',
	'authorization',
	'cookie',
	'set-cookie',
	'apiKey',
	'stripeSignature',
];

export class NoopErrorReporter implements IErrorReporter {
	capture(_error: unknown, _context?: ErrorContext): void {}
}

export interface SentryErrorReporterOptions {
	readonly dsn: string;
	readonly environment: string;
	readonly release: string;
}

export class SentryErrorReporter implements IErrorReporter {
	constructor(options: SentryErrorReporterOptions) {
		Sentry.init({
			dsn: options.dsn,
			environment: options.environment,
			release: options.release,
			sendDefaultPii: false,
			tracesSampleRate: 0,
			beforeSend: (event) => redactEvent(event),
		});
	}

	capture(error: unknown, context?: ErrorContext): void {
		try {
			Sentry.withScope((scope) => {
				if (context?.correlationId) scope.setTag('correlation_id', context.correlationId);
				if (context?.route) scope.setTag('route', context.route);
				if (context?.accountId) scope.setTag('account_id', context.accountId);
				if (context?.extra) scope.setContext('extra', redactObject(context.extra));

				Sentry.captureException(error);
			});
		} catch {
			return;
		}
	}
}

export function redactObject(value: Record<string, unknown>): Record<string, unknown> {
	const output: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (SENSITIVE_KEYS.some((sensitive) => sensitive.toLowerCase() === key.toLowerCase())) {
			output[key] = '[REDACTED]';
		} else if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
			output[key] = redactObject(entry as Record<string, unknown>);
		} else {
			output[key] = entry;
		}
	}
	return output;
}

function redactEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
	if (event.request?.headers) {
		event.request.headers = redactObject(event.request.headers) as Record<string, string>;
	}
	if (event.request?.data && typeof event.request.data === 'object') {
		event.request.data = redactObject(event.request.data as Record<string, unknown>);
	}
	if (event.request?.query_string) event.request.query_string = '[REDACTED]';
	return event;
}
