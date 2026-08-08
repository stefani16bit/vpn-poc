import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ENTITLEMENTS, type EntitlementsResponse } from '@vpn/contracts';

import type { AccessTokenClaims } from '../../../shared/access-control/access-token.service.js';
import type { EntitlementsService } from '../../../shared/entitlements/entitlements.service.js';
import { EntitlementsController } from './entitlements.controller.js';

const CLAIMS: AccessTokenClaims = {
	userId: 'user-1',
	accountId: 'acc-1',
	role: 'member',
	sessionId: 'sess-1',
	emailVerified: true,
};

const RESPONSE: EntitlementsResponse = { tier: 'pro', entitlements: ENTITLEMENTS.pro };

describe('EntitlementsController', () => {
	let entitlements: { forAccount: ReturnType<typeof vi.fn> };
	let controller: EntitlementsController;

	beforeEach(() => {
		entitlements = { forAccount: vi.fn().mockResolvedValue(RESPONSE) };
		controller = new EntitlementsController(entitlements as unknown as EntitlementsService);
	});

	it('answers for the account in the token and for no other', async () => {
		expect(await controller.current(CLAIMS)).toEqual(RESPONSE);
		expect(entitlements.forAccount).toHaveBeenCalledWith('acc-1');
	});

	it('answers a member the same as an owner: the tier is the company, not the person', async () => {
		await controller.current({ ...CLAIMS, role: 'owner' });

		expect(entitlements.forAccount).toHaveBeenCalledWith('acc-1');
	});
});
