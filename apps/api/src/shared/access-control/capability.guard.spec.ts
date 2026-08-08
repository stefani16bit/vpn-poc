import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ENTITLEMENTS, UNSUBSCRIBED_ENTITLEMENTS } from '@vpn/contracts';

import type { EntitlementsService } from '../entitlements/entitlements.service.js';
import { AppError } from '../errors/app-error.js';
import type { AuthenticatedRequest } from './authenticated-request.js';
import { CapabilityGuard } from './capability.guard.js';
import { REQUIRED_CAPABILITY, RequiresCapability } from './require-capability.decorator.js';

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

describe('CapabilityGuard', () => {
	let entitlements: { forAccount: ReturnType<typeof vi.fn>; invalidate: ReturnType<typeof vi.fn> };
	let guard: CapabilityGuard;

	function guardedHandler(): void {}
	function openHandler(): void {}

	class GuardedController {}

	beforeEach(() => {
		entitlements = {
			forAccount: vi.fn().mockResolvedValue({ tier: 'pro', entitlements: ENTITLEMENTS.pro }),
			invalidate: vi.fn(),
		};
		guard = new CapabilityGuard(entitlements as unknown as EntitlementsService, new Reflector());

		Reflect.defineMetadata(REQUIRED_CAPABILITY, 'vpn_access', guardedHandler);
		Reflect.defineMetadata(REQUIRED_CAPABILITY, 'vpn_access', GuardedController);
	});

	it('lets an unannotated route through without reading any entitlement', async () => {
		expect(await guard.canActivate(contextFor({ auth: CLAIMS }, openHandler))).toBe(true);
		expect(entitlements.forAccount).not.toHaveBeenCalled();
	});

	it('admits an account whose tier includes the capability', async () => {
		expect(await guard.canActivate(contextFor({ auth: CLAIMS }, guardedHandler))).toBe(true);
		expect(entitlements.forAccount).toHaveBeenCalledWith('acc-1');
	});

	it('answers 402 for an account with no tier, so the client knows to go and pay', async () => {
		entitlements.forAccount.mockResolvedValue({
			tier: null,
			entitlements: UNSUBSCRIBED_ENTITLEMENTS,
		});

		const context = contextFor({ auth: CLAIMS }, guardedHandler);

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
		const context = contextFor({}, guardedHandler);

		expect(await codeOf(guard.canActivate(context))).toBe('INTERNAL');
		expect(entitlements.forAccount).not.toHaveBeenCalled();
	});

	it('reads what the decorator itself writes, not a key spelled twice', async () => {
		class DecoratedController {
			@RequiresCapability('vpn_access')
			download(): void {}
		}
		entitlements.forAccount.mockResolvedValue({
			tier: null,
			entitlements: UNSUBSCRIBED_ENTITLEMENTS,
		});

		const context = contextFor({ auth: CLAIMS }, DecoratedController.prototype.download);

		expect(await codeOf(guard.canActivate(context))).toBe('PAYMENT_REQUIRED');
	});
});
