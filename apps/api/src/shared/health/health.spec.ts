import {
	Global,
	Module,
	ServiceUnavailableException,
	type ArgumentsHost,
	type INestApplication,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { HealthCheckService, TerminusModule } from '@nestjs/terminus';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ENV } from '@vpn-poc/adapters';
import { ERROR_REPORTER, type IErrorReporter } from '@vpn/ports';

import { GlobalExceptionFilter } from '../errors/exception.filter.js';
import { HealthCheckFilter } from './health-check.filter.js';
import { HealthController } from './health.controller.js';
import { HealthModule } from './health.module.js';
import type { HealthIndicator } from './health.types.js';

const LEAKED_DETAIL = 'no route to 10.0.1.5:5432';

function indicator(name: string, outcome: 'ok' | 'fail'): HealthIndicator {
	return {
		name,
		check:
			outcome === 'ok'
				? vi.fn().mockResolvedValue(undefined)
				: vi.fn().mockRejectedValue(new Error(LEAKED_DETAIL)),
	};
}

async function controllerWith(...indicators: HealthIndicator[]): Promise<HealthController> {
	const moduleRef = await Test.createTestingModule({
		imports: [TerminusModule.forRoot({ logger: false })],
	}).compile();

	return new HealthController(moduleRef.get(HealthCheckService), indicators, {
		APP_VERSION: '1.2.3',
	} as never);
}

async function readinessFailure(
	...indicators: HealthIndicator[]
): Promise<ServiceUnavailableException> {
	const controller = await controllerWith(...indicators);
	const failure = await controller.ready().then(
		() => null,
		(error: unknown) => error,
	);

	expect(failure).toBeInstanceOf(ServiceUnavailableException);
	return failure as ServiceUnavailableException;
}

describe('HealthController', () => {
	it('answers liveness without touching a dependency', async () => {
		const database = indicator('database', 'ok');
		const controller = await controllerWith(database);

		expect(controller.live()).toEqual({ status: 'ok', version: '1.2.3' });
		expect(database.check).not.toHaveBeenCalled();
	});

	it('reports readiness with a per-dependency breakdown', async () => {
		const controller = await controllerWith(indicator('database', 'ok'), indicator('cache', 'ok'));

		await expect(controller.ready()).resolves.toMatchObject({
			status: 'ok',
			details: { database: { status: 'up' }, cache: { status: 'up' } },
		});
	});

	it('fails the probe when a dependency is down, so the instance leaves rotation', async () => {
		const failure = await readinessFailure(indicator('database', 'ok'), indicator('cache', 'fail'));

		expect(failure.getStatus()).toBe(503);
		expect(failure.getResponse()).toMatchObject({
			status: 'error',
			error: { cache: { status: 'down' } },
		});
	});

	it('does not let one failing dependency hide the others', async () => {
		const failure = await readinessFailure(
			indicator('a', 'fail'),
			indicator('b', 'fail'),
			indicator('c', 'ok'),
		);

		expect(failure.getResponse()).toMatchObject({
			details: { a: { status: 'down' }, b: { status: 'down' }, c: { status: 'up' } },
		});
	});

	it('does not tell an unauthenticated caller why the dependency failed', async () => {
		const failure = await readinessFailure(indicator('cache', 'fail'));

		expect(JSON.stringify(failure.getResponse())).not.toContain(LEAKED_DETAIL);
	});

	it('reports ready with no indicators registered', async () => {
		const controller = await controllerWith();

		await expect(controller.ready()).resolves.toMatchObject({ status: 'ok', details: {} });
	});

	it('runs the indicators concurrently', async () => {
		const started: string[] = [];
		const slow = (name: string): HealthIndicator => ({
			name,
			check: async () => {
				started.push(name);
				await new Promise((resolve) => setTimeout(resolve, 10));
			},
		});

		const controller = await controllerWith(slow('a'), slow('b'));
		await controller.ready();

		expect(started).toEqual(['a', 'b']);
	});
});

describe('GET /health/ready', () => {
	let app: INestApplication | undefined;

	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	async function serve(
		reporter: IErrorReporter,
		...indicators: HealthIndicator[]
	): Promise<INestApplication> {
		@Global()
		@Module({
			providers: [
				{ provide: ENV, useValue: { APP_VERSION: '1.2.3' } },
				{ provide: ERROR_REPORTER, useValue: reporter },
			],
			exports: [ENV, ERROR_REPORTER],
		})
		class AdaptersStub {}

		const moduleRef = await Test.createTestingModule({
			imports: [
				AdaptersStub,
				HealthModule.forRoot({
					readiness: indicators.map((indicator) => ({
						provide: Symbol.for(`vpn.health.${indicator.name}`),
						useValue: indicator,
					})),
				}),
			],
			providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
		}).compile();

		app = await moduleRef.createNestApplication().init();
		return app;
	}

	it('answers 503 with the report, not the body the global filter would write', async () => {
		const capture = vi.fn();
		const served = await serve({ capture }, indicator('database', 'ok'), indicator('cache', 'fail'));

		const response = await request(served.getHttpServer()).get('/health/ready').expect(503);

		expect(response.body).toMatchObject({
			status: 'error',
			error: { cache: { status: 'down' } },
			details: { database: { status: 'up' }, cache: { status: 'down' } },
		});
		expect(response.body.code).toBeUndefined();
	});

	it('does not report a failing dependency to the error reporter', async () => {
		const capture = vi.fn();
		const served = await serve({ capture }, indicator('cache', 'fail'));

		await request(served.getHttpServer()).get('/health/ready').expect(503);

		expect(capture).not.toHaveBeenCalled();
	});
});

describe('HealthCheckFilter', () => {
	function hostFor(response: unknown): ArgumentsHost {
		return {
			switchToHttp: () => ({ getResponse: () => response }),
		} as unknown as ArgumentsHost;
	}

	it('answers with the report itself, not the generic error body', () => {
		const json = vi.fn();
		const status = vi.fn().mockReturnValue({ json });
		const report = { status: 'error', error: { cache: { status: 'down' } }, details: {} };

		new HealthCheckFilter().catch(new ServiceUnavailableException(report), hostFor({ status }));

		expect(status).toHaveBeenCalledWith(503);
		expect(json).toHaveBeenCalledWith(report);
	});
});
