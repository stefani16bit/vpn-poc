import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';

import {
	forgotPasswordRequestSchema,
	loginRequestSchema,
	registerRequestSchema,
	resendVerificationRequestSchema,
	resetPasswordRequestSchema,
	updateLocaleRequestSchema,
	verifyEmailRequestSchema,
	type AcknowledgedResponse,
	type AuthenticatedUser,
	type ForgotPasswordRequest,
	type LoginRequest,
	type RegisterRequest,
	type ResendVerificationRequest,
	type ResetPasswordRequest,
	type SessionResponse,
	type UpdateLocaleRequest,
	type VerifyEmailRequest,
} from '@vpn/contracts';

import { AppError } from '../../../shared/errors/app-error.js';
import { currentLocale } from '../../../shared/http/request-context.js';
import { ZodBody } from '../../../shared/validation/zod-body.pipe.js';
import type { AccessTokenClaims } from '../../../shared/access-control/access-token.service.js';
import { AccessTokenGuard } from '../../../shared/access-control/access-token.guard.js';
import { AllowUnverified } from '../../../shared/access-control/allow-unverified.decorator.js';
import { Auth } from '../../../shared/access-control/current-auth.decorator.js';
import { AuthService } from '../services/auth.service.js';
import { RefreshCookie } from './refresh-cookie.js';

const ACKNOWLEDGED: AcknowledgedResponse = { acknowledged: true };

@Controller('auth')
export class AuthController {
	constructor(
		private readonly auth: AuthService,
		private readonly refreshCookie: RefreshCookie,
	) {}

	@Post('register')
	@HttpCode(202)
	async register(
		@Body(new ZodBody(registerRequestSchema)) body: RegisterRequest,
	): Promise<AcknowledgedResponse> {
		await this.auth.register(body.email, body.password, body.locale ?? currentLocale());
		return ACKNOWLEDGED;
	}

	@Post('login')
	@HttpCode(200)
	async login(
		@Body(new ZodBody(loginRequestSchema)) body: LoginRequest,
		@Res({ passthrough: true }) response: Response,
	): Promise<SessionResponse> {
		const issued = await this.auth.login(body.email, body.password, body.slug);
		this.refreshCookie.set(response, issued.refreshToken, issued.refreshExpiresAt);
		return issued.response;
	}

	@Post('refresh')
	@HttpCode(200)
	async refresh(
		@Req() request: Request,
		@Res({ passthrough: true }) response: Response,
	): Promise<SessionResponse> {
		const token = this.refreshCookie.read(request);
		if (!token) throw new AppError('UNAUTHENTICATED', 'no session cookie');

		const issued = await this.auth.refresh(token);
		this.refreshCookie.set(response, issued.refreshToken, issued.refreshExpiresAt);
		return issued.response;
	}

	@Post('logout')
	@HttpCode(200)
	async logout(
		@Req() request: Request,
		@Res({ passthrough: true }) response: Response,
	): Promise<AcknowledgedResponse> {
		await this.auth.logout(this.refreshCookie.read(request));
		this.refreshCookie.clear(response);
		return ACKNOWLEDGED;
	}

	@Post('verify-email')
	@HttpCode(200)
	async verifyEmail(
		@Body(new ZodBody(verifyEmailRequestSchema)) body: VerifyEmailRequest,
	): Promise<AcknowledgedResponse> {
		await this.auth.verifyEmail(body.token);
		return ACKNOWLEDGED;
	}

	@Post('resend-verification')
	@HttpCode(202)
	async resendVerification(
		@Body(new ZodBody(resendVerificationRequestSchema)) body: ResendVerificationRequest,
	): Promise<AcknowledgedResponse> {
		await this.auth.resendVerification(body.email);
		return ACKNOWLEDGED;
	}

	@Post('forgot-password')
	@HttpCode(202)
	async forgotPassword(
		@Body(new ZodBody(forgotPasswordRequestSchema)) body: ForgotPasswordRequest,
	): Promise<AcknowledgedResponse> {
		await this.auth.forgotPassword(body.email);
		return ACKNOWLEDGED;
	}

	@Post('reset-password')
	@HttpCode(200)
	async resetPassword(
		@Body(new ZodBody(resetPasswordRequestSchema)) body: ResetPasswordRequest,
		@Res({ passthrough: true }) response: Response,
	): Promise<AcknowledgedResponse> {
		await this.auth.resetPassword(body.token, body.password);
		this.refreshCookie.clear(response);
		return ACKNOWLEDGED;
	}

	@Get('me')
	@UseGuards(AccessTokenGuard)
	@AllowUnverified()
	async me(@Auth() claims: AccessTokenClaims): Promise<AuthenticatedUser> {
		return this.auth.currentUser(claims.userId);
	}

	@Patch('me/locale')
	@UseGuards(AccessTokenGuard)
	@AllowUnverified()
	@HttpCode(200)
	async updateLocale(
		@Auth() claims: AccessTokenClaims,
		@Body(new ZodBody(updateLocaleRequestSchema)) body: UpdateLocaleRequest,
	): Promise<AuthenticatedUser> {
		return this.auth.setLocale(claims.userId, body.locale);
	}
}
