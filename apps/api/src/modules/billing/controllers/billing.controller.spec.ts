import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccessTokenClaims } from '../../../shared/access-control/access-token.service.js';
import { AppError } from '../../../shared/errors/app-error.js';
import type { BillingService } from '../services/billing.service.js';
import { BillingController } from './billing.controller.js';

const CLAIMS: AccessTokenClaims = {
	accountId: 'acc-1',
	sessionId: 'sess-1',
	emailVerified: true,
};

const SUBSCRIPTION = { status: 'active', currentPeriodEnd: null, cancelAtPeriodEnd: false } as const;

type Mock = ReturnType<typeof vi.fn>;

interface BillingMock {
	createCheckout: Mock;
	currentSubscription: Mock;
	cancel: Mock;
	handleWebhook: Mock;
}

describe('BillingController', () => {
	let billing: BillingMock;
	let controller: BillingController;

	beforeEach(() => {
		billing = {
			createCheckout: vi.fn().mockResolvedValue('https://checkout.example/session'),
			currentSubscription: vi.fn().mockResolvedValue(SUBSCRIPTION),
			cancel: vi.fn().mockResolvedValue(undefined),
			handleWebhook: vi.fn().mockResolvedValue(true),
		};
		controller = new BillingController(billing as unknown as BillingService);
	});

	it('wraps the checkout url in the response shape', async () => {
		const response = await controller.createCheckout(CLAIMS, { plan: 'monthly' });

		expect(response).toEqual({ checkoutUrl: 'https://checkout.example/session' });
		expect(billing.createCheckout).toHaveBeenCalledWith('acc-1', 'monthly');
	});

	it('reads the subscription for the authenticated account only', async () => {
		expect(await controller.subscription(CLAIMS)).toEqual(SUBSCRIPTION);
		expect(billing.currentSubscription).toHaveBeenCalledWith('acc-1');
	});

	it('returns the refreshed subscription after cancelling', async () => {
		expect(await controller.cancel(CLAIMS)).toEqual(SUBSCRIPTION);
		expect(billing.cancel).toHaveBeenCalledWith('acc-1');
		expect(billing.currentSubscription).toHaveBeenCalledWith('acc-1');
	});

	it('passes the raw bytes to the webhook, not a reserialised body', async () => {
		const rawBody = Buffer.from('{"id":"evt_1"}', 'utf8');
		const request = { rawBody } as unknown as Request;

		expect(await controller.webhook(request, 'sig')).toEqual({ applied: true });
		expect(billing.handleWebhook).toHaveBeenCalledWith('{"id":"evt_1"}', 'sig');
	});

	it('treats a missing signature header as an empty one, leaving the verdict to the provider', async () => {
		const request = { rawBody: Buffer.from('{}', 'utf8') } as unknown as Request;

		await controller.webhook(request, undefined);

		expect(billing.handleWebhook).toHaveBeenCalledWith('{}', '');
	});

	it('fails loudly when raw body capture was not mounted for the route', async () => {
		const request = {} as unknown as Request;

		try {
			await controller.webhook(request, 'sig');
			expect.unreachable('should have thrown');
		} catch (error) {
			expect((error as AppError).code).toBe('INTERNAL');
		}
		expect(billing.handleWebhook).not.toHaveBeenCalled();
	});

	it('reports a redelivered webhook as not applied', async () => {
		billing.handleWebhook.mockResolvedValue(false);
		const request = { rawBody: Buffer.from('{}', 'utf8') } as unknown as Request;

		expect(await controller.webhook(request, 'sig')).toEqual({ applied: false });
	});
});
