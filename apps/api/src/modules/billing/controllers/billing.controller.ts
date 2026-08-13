import {
	Body,
	Controller,
	Delete,
	Get,
	Headers,
	HttpCode,
	Param,
	Post,
	Req,
	Res,
	UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import {
	createCheckoutRequestSchema,
	type CreateCheckoutRequest,
	type CreateCheckoutResponse,
	type InvoiceListResponse,
	type SubscriptionResponse,
} from '@vpn/contracts';

import { SkipTenantTransaction } from '../../../shared/database/skip-tenant-transaction.decorator.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { ZodBody } from '../../../shared/validation/zod-body.pipe.js';
import type { AccessTokenClaims } from '../../../shared/access-control/access-token.service.js';
import { AccessTokenGuard } from '../../../shared/access-control/access-token.guard.js';
import { Auth } from '../../../shared/access-control/current-auth.decorator.js';
import { PermissionGuard } from '../../../shared/access-control/permission.guard.js';
import { RequiresPermission } from '../../../shared/access-control/require-permission.decorator.js';
import { BillingService } from '../services/billing.service.js';

interface RawBodyRequest extends Request {
	rawBody?: Buffer;
}

@Controller('billing')
export class BillingController {
	constructor(private readonly billing: BillingService) {}

	@Post('checkout')
	@UseGuards(AccessTokenGuard, PermissionGuard)
	@RequiresPermission('billing.manage')
	@SkipTenantTransaction()
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

	// No @RequiresSubscription on either of these: whoever cancelled is exactly
	// who needs the receipts, and the guard would answer 402 to them. Same
	// exception, same reason, as GET /billing/subscription.
	@Get('invoices')
	@UseGuards(AccessTokenGuard, PermissionGuard)
	@RequiresPermission('billing.manage')
	async invoices(@Auth() claims: AccessTokenClaims): Promise<InvoiceListResponse> {
		return this.billing.listInvoices(claims.accountId);
	}

	@Get('invoices/:id/pdf')
	@UseGuards(AccessTokenGuard, PermissionGuard)
	@RequiresPermission('billing.manage')
	async invoicePdf(
		@Auth() claims: AccessTokenClaims,
		@Param('id') id: string,
		@Res() response: Response,
	): Promise<void> {
		const pdf = await this.billing.invoicePdf(claims.accountId, id);

		response.setHeader('content-type', 'application/pdf');
		response.setHeader('content-disposition', `attachment; filename="invoice-${id}.pdf"`);
		response.send(Buffer.from(pdf));
	}

	@Delete('subscription')
	@UseGuards(AccessTokenGuard, PermissionGuard)
	@RequiresPermission('billing.manage')
	@HttpCode(200)
	async cancel(@Auth() claims: AccessTokenClaims): Promise<SubscriptionResponse> {
		await this.billing.cancel(claims.accountId);
		return this.billing.currentSubscription(claims.accountId);
	}

	@Post('subscription/resume')
	@UseGuards(AccessTokenGuard, PermissionGuard)
	@RequiresPermission('billing.manage')
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
