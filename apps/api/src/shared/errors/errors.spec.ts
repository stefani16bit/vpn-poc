import type { ArgumentsHost } from '@nestjs/common';
import { HttpException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { API_ERROR_CODES } from '@vpn/contracts';
import type { IErrorReporter } from '@vpn/ports';

import { runWithCorrelation } from '../http/request-context.js';
import { AppError, statusForCode } from './app-error.js';
import { GlobalExceptionFilter } from './exception.filter.js';

describe('AppError', () => {
	it('derives the status from the code', () => {
		expect(new AppError('INVALID_CREDENTIALS', 'nope').status).toBe(401);
		expect(new AppError('RATE_LIMITED', 'slow down').status).toBe(429);
		expect(new AppError('PAYMENT_REQUIRED', 'subscribe').status).toBe(402);
	});

	it('maps every published code to a status', () => {
		for (const code of API_ERROR_CODES) {
			expect(typeof statusForCode(code)).toBe('number');
		}
	});

	it('carries field errors when there are any', () => {
		const error = new AppError('VALIDATION_FAILED', 'bad', { email: 'required' });
		expect(error.fields).toEqual({ email: 'required' });
	});
});

describe('GlobalExceptionFilter', () => {
	function harness(exception: unknown) {
		const json = vi.fn();
		const status = vi.fn().mockReturnValue({ json });
		const setHeader = vi.fn();
		const capture = vi.fn();

		const reporter: IErrorReporter = { capture };
		const filter = new GlobalExceptionFilter(reporter);

		const host = {
			switchToHttp: () => ({
				getResponse: () => ({ status, setHeader }),
				getRequest: () => ({ method: 'POST', url: '/auth/login' }),
			}),
		} as unknown as ArgumentsHost;

		runWithCorrelation('corr-1', () => filter.catch(exception, host));

		return { status, json, setHeader, capture };
	}

	it('renders an AppError with its code and correlation id', () => {
		const { status, json } = harness(new AppError('INVALID_CREDENTIALS', 'nope'));

		expect(status).toHaveBeenCalledWith(401);
		expect(json).toHaveBeenCalledWith({
			code: 'INVALID_CREDENTIALS',
			message: 'nope',
			correlationId: 'corr-1',
		});
	});

	it('includes field errors when the AppError has them', () => {
		const { json } = harness(new AppError('VALIDATION_FAILED', 'bad', { email: 'required' }));
		expect(json.mock.calls[0]?.[0]).toMatchObject({ fields: { email: 'required' } });
	});

	it('hides the detail of an unexpected error', () => {
		const { status, json } = harness(new Error('relation "accounts" does not exist'));

		expect(status).toHaveBeenCalledWith(500);
		const body = json.mock.calls[0]?.[0] as { code: string; message: string };
		expect(body.code).toBe('INTERNAL');
		expect(body.message).not.toContain('accounts');
	});

	it('maps a Nest HttpException onto the published vocabulary', () => {
		const { json } = harness(new NotFoundException('no route'));
		expect((json.mock.calls[0]?.[0] as { code: string }).code).toBe('NOT_FOUND');
	});

	it('treats an unmapped 4xx from Nest as a validation failure', () => {
		const { json } = harness(new HttpException('bad payload', 400));
		expect((json.mock.calls[0]?.[0] as { code: string }).code).toBe('VALIDATION_FAILED');
	});

	it('does not report a client error', () => {
		const { capture } = harness(new AppError('INVALID_CREDENTIALS', 'nope'));
		expect(capture).not.toHaveBeenCalled();
	});

	it('reports a server error, with the correlation id attached', () => {
		const { capture } = harness(new Error('boom'));

		expect(capture).toHaveBeenCalledOnce();
		expect(capture.mock.calls[0]?.[1]).toMatchObject({
			correlationId: 'corr-1',
			route: 'POST /auth/login',
		});
	});

	it('puts the correlation id on the response header too', () => {
		const { setHeader } = harness(new AppError('NOT_FOUND', 'gone'));
		expect(setHeader).toHaveBeenCalledWith('x-correlation-id', 'corr-1');
	});
});
