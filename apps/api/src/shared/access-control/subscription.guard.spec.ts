import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ENTITLEMENTS, UNSUBSCRIBED_ENTITLEMENTS } from '@vpn/contracts';

import type { EntitlementsService } from '../entitlements/entitlements.service.js';
import { AppError } from '../errors/app-error.js';
import type { AuthenticatedRequest } from './authenticated-request.js';
import { REQUIRED_SUBSCRIPTION, RequiresSubscription } from './require-subscription.decorator.js';
import { SubscriptionGuard } from './subscription.guard.js';

const CLAIMS = {
	userId: 'user-1',
	accountId: 'acc-1',
	role: 'owner' as const,
	sessionId: 'sess-1',
	emailVerified: true,
};

function contextFor(
	request: Partial<AuthenticatedRequest>,
	handler: () => void,
	klass: new () => unknown = class {},
): ExecutionContext {
	return {
		switchToHttp: () => ({ getRequest: () => request }),
		getHandler: () => handler,
		getClass: () => klass,
	} as unknown as ExecutionContext;
}

async function codeOf(run: Promise<unknown>): Promise<string> {
	try {
		await run;
		expect.unreachable('should have thrown');
	} catch (error) {
		expect(error).toBeInstanceOf(AppError);
		return (error as AppError).code;
	}
}

describe('SubscriptionGuard', () => {
	let entitlements: { forAccount: ReturnType<typeof vi.fn> };
	let guard: SubscriptionGuard;

	function guardedHandler(): void {}
	function openHandler(): void {}

	class GuardedController {}

	beforeEach(() => {
		entitlements = {
			forAccount: vi.fn().mockResolvedValue({ tier: 'pro', entitlements: ENTITLEMENTS.pro }),
		};
		guard = new SubscriptionGuard(entitlements as unknown as EntitlementsService, new Reflector());

		Reflect.defineMetadata(REQUIRED_SUBSCRIPTION, true, guardedHandler);
		Reflect.defineMetadata(REQUIRED_SUBSCRIPTION, true, GuardedController);
	});

	it('lets an unannotated route through without reading any tier', async () => {
		expect(await guard.canActivate(contextFor({ auth: CLAIMS }, openHandler))).toBe(true);
		expect(entitlements.forAccount).not.toHaveBeenCalled();
	});

	it('admits an account that is paying', async () => {
		expect(await guard.canActivate(contextFor({ auth: CLAIMS }, guardedHandler))).toBe(true);
		expect(entitlements.forAccount).toHaveBeenCalledWith('acc-1');
	});

	it('answers 402 when there is no tier, so the client knows to go and pay', async () => {
		entitlements.forAccount.mockResolvedValue({
			tier: null,
			entitlements: UNSUBSCRIBED_ENTITLEMENTS,
		});

		expect(await codeOf(guard.canActivate(contextFor({ auth: CLAIMS }, guardedHandler)))).toBe(
			'PAYMENT_REQUIRED',
		);
	});

	it('refuses the owner too, because the question is what the company bought', async () => {
		entitlements.forAccount.mockResolvedValue({
			tier: null,
			entitlements: UNSUBSCRIBED_ENTITLEMENTS,
		});

		const context = contextFor({ auth: { ...CLAIMS, role: 'owner' } }, guardedHandler);

		expect(await codeOf(guard.canActivate(context))).toBe('PAYMENT_REQUIRED');
	});

	it('reads the requirement off the class when the handler carries none', async () => {
		entitlements.forAccount.mockResolvedValue({
			tier: null,
			entitlements: UNSUBSCRIBED_ENTITLEMENTS,
		});

		const context = contextFor({ auth: CLAIMS }, openHandler, GuardedController);

		expect(await codeOf(guard.canActivate(context))).toBe('PAYMENT_REQUIRED');
	});

	it('refuses to guess an account when no AccessTokenGuard ran before it', async () => {
		expect(await codeOf(guard.canActivate(contextFor({}, guardedHandler)))).toBe('INTERNAL');
		expect(entitlements.forAccount).not.toHaveBeenCalled();
	});

	it('reads what the decorator itself writes, not a key spelled twice', async () => {
		class DecoratedController {
			list(): void {}
		}
		RequiresSubscription()(
			DecoratedController.prototype,
			'list',
			Object.getOwnPropertyDescriptor(DecoratedController.prototype, 'list') as PropertyDescriptor,
		);
		entitlements.forAccount.mockResolvedValue({
			tier: null,
			entitlements: UNSUBSCRIBED_ENTITLEMENTS,
		});

		const context = contextFor({ auth: CLAIMS }, DecoratedController.prototype.list);

		expect(await codeOf(guard.canActivate(context))).toBe('PAYMENT_REQUIRED');
	});
});
