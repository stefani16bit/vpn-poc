import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { AppModule, OutboxConsumer, OutboxRelay } from '@vpn-poc/api/worker';

const IDLE_PAUSE_MS = 500;
const RECEIVE_WAIT_SECONDS = 5;

async function main(): Promise<void> {
	const context = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
	context.useLogger(context.get(Logger));
	context.enableShutdownHooks();

	const logger = context.get(Logger);
	const relay = context.get(OutboxRelay);
	const consumer = context.get(OutboxConsumer);

	let running = true;
	const stop = async (): Promise<void> => {
		running = false;
		await context.close();
	};
	process.on('SIGINT', stop);
	process.on('SIGTERM', stop);

	logger.log({ event: 'worker.started' });

	while (running) {
		const published = await relay.runOnce().catch((error: unknown) => {
			logger.error({ event: 'worker.relay_failed', error });
			return 0;
		});

		const report = await consumer.runOnce(RECEIVE_WAIT_SECONDS).catch((error: unknown) => {
			logger.error({ event: 'worker.consume_failed', error });
			return { received: 0, unknown: [], failed: [] };
		});

		for (const name of report.unknown) logger.warn({ event: 'worker.unknown_job', name });
		for (const failure of report.failed) {
			logger.error({ event: 'worker.dispatch_failed', ...failure });
		}

		if (published === 0 && report.received === 0) {
			await new Promise((resolve) => setTimeout(resolve, IDLE_PAUSE_MS));
		}
	}
}

await main();
