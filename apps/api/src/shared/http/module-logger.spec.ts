import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { MODULE_LOGGER, contextLogger, moduleLoggerProvider } from './module-logger.js';

function collector(): {
	records: Record<string, unknown>[];
	stream: { write: (l: string) => void };
} {
	const records: Record<string, unknown>[] = [];
	return {
		records,
		stream: {
			write: (line: string) => {
				records.push(JSON.parse(line) as Record<string, unknown>);
			},
		},
	};
}

describe('module logger', () => {
	it('publishes under the shared token so a service never names a module', () => {
		expect(moduleLoggerProvider('auth').provide).toBe(MODULE_LOGGER);
	});

	it('binds the module onto the root logger exactly once', () => {
		const child = { name: 'child' };
		const logger = { child: vi.fn().mockReturnValue(child) };
		const provider = moduleLoggerProvider('billing');

		const built = provider.useFactory({ logger } as never);

		expect(logger.child).toHaveBeenCalledTimes(1);
		expect(logger.child).toHaveBeenCalledWith({ module: 'billing' });
		expect(built).toBe(child);
	});

	it('carries the module and the class name on the same record', () => {
		const { records, stream } = collector();
		const moduleLogger = pino({ level: 'debug' }, stream).child({ module: 'auth' });

		contextLogger(moduleLogger, 'AuthService').debug({ event: 'register.duplicate' }, 'msg');

		expect(records[0]).toMatchObject({
			module: 'auth',
			context: 'AuthService',
			event: 'register.duplicate',
			msg: 'msg',
		});
	});

	it('is overridden by a mixin that ignores the binding, which is why the mixin reads it', () => {
		const { records, stream } = collector();
		const root = pino({ level: 'debug', mixin: () => ({ module: 'http' }) }, stream);

		root.child({ module: 'auth' }).debug('emitted by auth');

		expect(records[0]?.module).toBe('http');
	});

	it('lets the emitting module win once the mixin defers to the binding', () => {
		const { records, stream } = collector();
		const root = pino(
			{
				level: 'debug',
				mixin: (_merge, _level, logger) => ({ module: logger?.bindings().module ?? 'http' }),
			},
			stream,
		);

		root.child({ module: 'auth' }).debug('emitted by auth');
		root.debug('emitted by the router');

		expect(records[0]?.module).toBe('auth');
		expect(records[1]?.module).toBe('http');
	});
});
