import 'reflect-metadata';

import { configure as serverlessExpress } from '@codegenie/serverless-express';
import type { Context, Handler } from 'aws-lambda';

import { createApp } from '@vpn-poc/api';

let cached: Promise<Handler> | null = null;

async function bootstrap(): Promise<Handler> {
	const app = await createApp();
	await app.init();

	return serverlessExpress({ app: app.getHttpAdapter().getInstance() });
}

export const handler: Handler = async (event, context: Context, callback) => {
	context.callbackWaitsForEmptyEventLoop = false;

	cached ??= bootstrap();
	const ready = await cached;

	return ready(event, context, callback);
};
