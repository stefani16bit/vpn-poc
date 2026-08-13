import {
	type ArgumentsHost,
	Catch,
	type ExceptionFilter,
	HttpException,
	Inject,
	Logger,
} from '@nestjs/common';
import type { Response } from 'express';

import type { ApiErrorResponse } from '@vpn/contracts';
import { ERROR_REPORTER, type IErrorReporter } from '@vpn/ports';

import { CORRELATION_HEADER, currentCorrelationId } from '../http/request-context.js';
import { AppError } from './app-error.js';

const RETRY_AFTER_HEADER = 'retry-after';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
	readonly #logger = new Logger(GlobalExceptionFilter.name);

	constructor(@Inject(ERROR_REPORTER) private readonly reporter: IErrorReporter) {}

	catch(exception: unknown, host: ArgumentsHost): void {
		const http = host.switchToHttp();
		const response = http.getResponse<Response>();
		const request = http.getRequest<{ method?: string; url?: string }>();
		const correlationId = currentCorrelationId() ?? 'unknown';

		const body = this.#toBody(exception, correlationId);
		const status = this.#toStatus(exception, body);

		if (status >= 500) {
			this.#logger.error(
				{ err: exception, correlationId, route: `${request.method} ${request.url}` },
				'request failed',
			);
			this.reporter.capture(exception, {
				correlationId,
				route: `${request.method ?? ''} ${request.url ?? ''}`.trim(),
			});
		}

		response.setHeader(CORRELATION_HEADER, correlationId);

		// The header is what an HTTP client honours; the body field is what the
		// screen reads to word the wait. Without one of them the 429 tells the
		// caller to wait without saying how long.
		if (typeof body.retryAfterSeconds === 'number') {
			response.setHeader(RETRY_AFTER_HEADER, String(body.retryAfterSeconds));
		}

		response.status(status).json(body);
	}

	#toBody(exception: unknown, correlationId: string): ApiErrorResponse {
		if (exception instanceof AppError) {
			return {
				code: exception.code,
				message: exception.message,
				correlationId,
				...(exception.fields ? { fields: exception.fields } : {}),
				...(typeof exception.retryAfterSeconds === 'number'
					? { retryAfterSeconds: exception.retryAfterSeconds }
					: {}),
			};
		}

		if (exception instanceof HttpException) {
			const status = exception.getStatus();
			return {
				code:
					status === 404
						? 'NOT_FOUND'
						: status === 401
							? 'UNAUTHENTICATED'
							: status === 403
								? 'FORBIDDEN'
								: status >= 500
									? 'INTERNAL'
									: 'VALIDATION_FAILED',
				message: exception.message,
				correlationId,
			};
		}

		return {
			code: 'INTERNAL',
			message: 'an unexpected error occurred',
			correlationId,
		};
	}

	#toStatus(exception: unknown, body: ApiErrorResponse): number {
		if (exception instanceof AppError) return exception.status;
		if (exception instanceof HttpException) return exception.getStatus();
		void body;
		return 500;
	}
}
