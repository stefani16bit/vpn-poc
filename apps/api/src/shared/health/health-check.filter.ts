import {
	type ArgumentsHost,
	Catch,
	type ExceptionFilter,
	Logger,
	ServiceUnavailableException,
} from '@nestjs/common';
import type { Response } from 'express';

@Catch(ServiceUnavailableException)
export class HealthCheckFilter implements ExceptionFilter {
	readonly #logger = new Logger(HealthCheckFilter.name);

	catch(exception: ServiceUnavailableException, host: ArgumentsHost): void {
		const report = exception.getResponse();

		this.#logger.warn(report, 'readiness probe failed');

		host.switchToHttp().getResponse<Response>().status(exception.getStatus()).json(report);
	}
}
