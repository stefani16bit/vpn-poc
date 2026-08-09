import {
	Body,
	Controller,
	Delete,
	Get,
	Headers,
	HttpCode,
	Post,
	Req,
	UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import {
	createCheckoutRequestSchema,
	type CreateCheckoutRequest,
	type CreateCheckoutResponse,
	type SubscriptionResponse,
} from '@vpn/contracts';

import { AppError } from '../../../shared/errors/app-error.js';
import { ZodBody } from '../../../shared/validation/zod-body.pipe.js';
import type { AccessTokenClaims } from '../../../shared/access-control/access-token.service.js';
import { AccessTokenGuard } from '../../../shared/access-control/access-token.guard.js';
import { Auth } from '../../../shared/access-control/current-auth.decorator.js';
import { BillingService } from '../services/billing.service.js';

interface RawBodyRequest extends Request {
	rawBody?: Buffer;
}

@Controller('billing')
export class BillingController {
	constructor(private readonly billing: BillingService) {}

	@Post('checkout')
	@UseGuards(AccessTokenGuard)
	@HttpCode(200)
	async createCheckout(
		@Auth() claims: AccessTokenClaims,
		@Body(new ZodBody(createCheckoutRequestSchema)) body: CreateCheckoutRequest,
	): Promise<CreateCheckoutResponse> {
		return {
			checkoutUrl: await this.billing.createCheckout(claims.accountId, body.tier, body.cadence),
		};
	}

	@Get('subscription')
	@UseGuards(AccessTokenGuard)
	async subscription(@Auth() claims: AccessTokenClaims): Promise<SubscriptionResponse> {
		return this.billing.currentSubscription(claims.accountId);
	}

	@Delete('subscription')
	@UseGuards(AccessTokenGuard)
	@HttpCode(200)
	async cancel(@Auth() claims: AccessTokenClaims): Promise<SubscriptionResponse> {
		await this.billing.cancel(claims.accountId);
		return this.billing.currentSubscription(claims.accountId);
	}

	@Post('subscription/resume')
	@UseGuards(AccessTokenGuard)
	@HttpCode(200)
	async resume(@Auth() claims: AccessTokenClaims): Promise<SubscriptionResponse> {
		await this.billing.resume(claims.accountId);
		return this.billing.currentSubscription(claims.accountId);
	}

	@Post('webhook')
	@HttpCode(200)
	async webhook(
		@Req() request: RawBodyRequest,
		@Headers('stripe-signature') signature: string | undefined,
	): Promise<{ applied: boolean }> {
		if (!request.rawBody) {
			throw new AppError('INTERNAL', 'raw body capture is not configured for this route');
		}

		const applied = await this.billing.handleWebhook(
			request.rawBody.toString('utf8'),
			signature ?? '',
		);

		return { applied };
	}
}
