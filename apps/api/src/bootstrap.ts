import cookieParser from 'cookie-parser';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import { Logger } from 'nestjs-pino';

import { loadEnv } from '@vpn-poc/env';

import { AppModule } from './app.module.js';
import { requestContextMiddleware } from './shared/http/request-context.js';

export async function createApp(): Promise<INestApplication> {
	const env = loadEnv();

	const app = await NestFactory.create<NestExpressApplication>(AppModule, {
		bufferLogs: true,
	});

	app.useLogger(app.get(Logger));

	app.use(requestContextMiddleware);
	app.use(cookieParser());

	app.use(
		'/billing/webhook',
		express.json({
			verify: (req, _res, buffer) => {
				(req as { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
			},
		}),
	);
	app.use(express.json({ limit: '100kb' }));

	app.enableCors({
		origin: env.WEB_ORIGIN,
		credentials: true,
	});

	app.enableShutdownHooks();

	return app;
}
