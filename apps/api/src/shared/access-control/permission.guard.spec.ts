import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../errors/app-error.js';
import type { PermissionService } from '../permissions/permission.service.js';
import type { AuthenticatedRequest } from './authenticated-request.js';
import { PermissionGuard } from './permission.guard.js';
import { REQUIRED_PERMISSION, RequiresPermission } from './require-permission.decorator.js';

const CLAIMS = {
	userId: 'user-1',
	accountId: 'acc-1',
	role: 'member' as const,
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

describe('PermissionGuard', () => {
	let permissions: { has: ReturnType<typeof vi.fn> };
	let guard: PermissionGuard;

	function guardedHandler(): void {}
	function openHandler(): void {}

	class GuardedController {}

	beforeEach(() => {
		permissions = { has: vi.fn().mockResolvedValue(true) };
		guard = new PermissionGuard(permissions as unknown as PermissionService, new Reflector());

		Reflect.defineMetadata(REQUIRED_PERMISSION, 'devices.create', guardedHandler);
		Reflect.defineMetadata(REQUIRED_PERMISSION, 'devices.create', GuardedController);
	});

	it('lets an unannotated route through without reading any grant', async () => {
		expect(await guard.canActivate(contextFor({ auth: CLAIMS }, openHandler))).toBe(true);
		expect(permissions.has).not.toHaveBeenCalled();
	});

	it('asks about the caller, not only about the role', async () => {
		expect(await guard.canActivate(contextFor({ auth: CLAIMS }, guardedHandler))).toBe(true);
		expect(permissions.has).toHaveBeenCalledWith('acc-1', 'user-1', 'member', 'devices.create');
	});

	it('answers 403, because the refusal is about who you are and not about the plan', async () => {
		permissions.has.mockResolvedValue(false);

		expect(await codeOf(guard.canActivate(contextFor({ auth: CLAIMS }, guardedHandler)))).toBe(
			'FORBIDDEN',
		);
	});

	it('reads the requirement off the class when the handler carries none', async () => {
		permissions.has.mockResolvedValue(false);

		const context = contextFor({ auth: CLAIMS }, openHandler, GuardedController);

		expect(await codeOf(guard.canActivate(context))).toBe('FORBIDDEN');
	});

	it('refuses to guess a caller when no AccessTokenGuard ran before it', async () => {
		expect(await codeOf(guard.canActivate(contextFor({}, guardedHandler)))).toBe('INTERNAL');
		expect(permissions.has).not.toHaveBeenCalled();
	});

	it('reads what the decorator itself writes, not a key spelled twice', async () => {
		class DecoratedController {
			@RequiresPermission('devices.create')
			create(): void {}
		}
		permissions.has.mockResolvedValue(false);

		const context = contextFor({ auth: CLAIMS }, DecoratedController.prototype.create);

		expect(await codeOf(guard.canActivate(context))).toBe('FORBIDDEN');
	});
});
