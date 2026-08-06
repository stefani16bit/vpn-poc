import type { FactoryProvider } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { Logger } from 'pino';

import type { ApiModule } from './api-module.js';

export const MODULE_LOGGER = 'MODULE_LOGGER';

export type ModuleLogger = Logger;

export function moduleLoggerProvider(module: ApiModule): FactoryProvider<ModuleLogger> {
	return {
		provide: MODULE_LOGGER,
		inject: [PinoLogger],
		useFactory: (root: PinoLogger) => root.logger.child({ module }),
	};
}

export function contextLogger(logger: ModuleLogger, context: string): ModuleLogger {
	return logger.child({ context });
}
