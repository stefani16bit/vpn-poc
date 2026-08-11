import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { AppError } from '../errors/app-error.js';
import type { UserRole } from '../identity/user.js';
import type { AuthenticatedRequest } from './authenticated-request.js';
import { REQUIRED_ROLE, RequiresRole } from './require-role.decorator.js';
import { RoleGuard } from './role.guard.js';

function claims(role: UserRole) {
	return {
		userId: 'user-1',
		accountId: 'acc-1',
		role,
		sessionId: 'sess-1',
		emailVerified: true,
	};
}

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

function codeOf(run: () => unknown): string {
	try {
		run();
		expect.unreachable('should have thrown');
	} catch (error) {
		expect(error).toBeInstanceOf(AppError);
		return (error as AppError).code;
	}
}

describe('RoleGuard', () => {
	let guard: RoleGuard;

	function guardedHandler(): void {}
	function openHandler(): void {}

	class GuardedController {}

	beforeEach(() => {
		guard = new RoleGuard(new Reflector());

		Reflect.defineMetadata(REQUIRED_ROLE, 'admin', guardedHandler);
		Reflect.defineMetadata(REQUIRED_ROLE, 'admin', GuardedController);
	});

	it('lets an unannotated route through, which is why /devices keeps both roles', () => {
		expect(guard.canActivate(contextFor({ auth: claims('member') }, openHandler))).toBe(true);
	});

	it('admits the role it asks for', () => {
		expect(guard.canActivate(contextFor({ auth: claims('admin') }, guardedHandler))).toBe(true);
	});

	it('admits a role above the one it asks for, because owner outranks admin', () => {
		expect(guard.canActivate(contextFor({ auth: claims('owner') }, guardedHandler))).toBe(true);
	});

	it('answers 403 below the bar, and not 402 — the plan is not the problem here', () => {
		const context = contextFor({ auth: claims('member') }, guardedHandler);

		expect(codeOf(() => guard.canActivate(context))).toBe('FORBIDDEN');
	});

	it('reads the requirement off the class when the handler carries none', () => {
		const context = contextFor({ auth: claims('member') }, openHandler, GuardedController);

		expect(codeOf(() => guard.canActivate(context))).toBe('FORBIDDEN');
	});

	it('refuses to guess a role when no AccessTokenGuard ran before it', () => {
		expect(codeOf(() => guard.canActivate(contextFor({}, guardedHandler)))).toBe('INTERNAL');
	});

	it('reads what the decorator itself writes, not a key spelled twice', () => {
		class DecoratedController {
			@RequiresRole('admin')
			list(): void {}
		}

		const context = contextFor({ auth: claims('member') }, DecoratedController.prototype.list);

		expect(codeOf(() => guard.canActivate(context))).toBe('FORBIDDEN');
	});
});
