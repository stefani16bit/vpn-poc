import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';

import { ENV } from '@vpn-poc/adapters';
import type { Env } from '@vpn-poc/env';
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
import { Inject } from '@nestjs/common';

import { AppError } from '../../shared/errors/app-error.js';
import { currentLocale } from '../../shared/http/request-context.js';
import { ZodBody } from '../../shared/validation/zod-body.pipe.js';
import type { AccessTokenClaims } from './access-token.service.js';
import { AccessTokenGuard, AllowUnverified, Auth } from './auth.guard.js';
import type { IssuedSession } from './auth.service.js';
import { AuthService } from './auth.service.js';

const REFRESH_COOKIE = 'poc_vpn_refresh';
const ACKNOWLEDGED: AcknowledgedResponse = { acknowledged: true };

@Controller('auth')
export class AuthController {
	constructor(
		private readonly auth: AuthService,
		@Inject(ENV) private readonly env: Env,
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
		const issued = await this.auth.login(body.email, body.password);
		this.#setRefreshCookie(response, issued);
		return issued.response;
	}

	@Post('refresh')
	@HttpCode(200)
	async refresh(
		@Req() request: Request,
		@Res({ passthrough: true }) response: Response,
	): Promise<SessionResponse> {
		const token = this.#refreshCookie(request);
		if (!token) throw new AppError('UNAUTHENTICATED', 'no session cookie');

		const issued = await this.auth.refresh(token);
		this.#setRefreshCookie(response, issued);
		return issued.response;
	}

	@Post('logout')
	@HttpCode(200)
	async logout(
		@Req() request: Request,
		@Res({ passthrough: true }) response: Response,
	): Promise<AcknowledgedResponse> {
		await this.auth.logout(this.#refreshCookie(request));
		response.clearCookie(REFRESH_COOKIE, this.#cookieOptions());
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
		response.clearCookie(REFRESH_COOKIE, this.#cookieOptions());
		return ACKNOWLEDGED;
	}

	@Get('me')
	@UseGuards(AccessTokenGuard)
	@AllowUnverified()
	async me(@Auth() claims: AccessTokenClaims): Promise<AuthenticatedUser> {
		return this.auth.currentUser(claims.accountId);
	}

	@Patch('me/locale')
	@UseGuards(AccessTokenGuard)
	@AllowUnverified()
	@HttpCode(200)
	async updateLocale(
		@Auth() claims: AccessTokenClaims,
		@Body(new ZodBody(updateLocaleRequestSchema)) body: UpdateLocaleRequest,
	): Promise<AuthenticatedUser> {
		return this.auth.setLocale(claims.accountId, body.locale);
	}

	#refreshCookie(request: Request): string | undefined {
		return (request.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
	}

	#setRefreshCookie(response: Response, issued: IssuedSession): void {
		response.cookie(REFRESH_COOKIE, issued.refreshToken, {
			...this.#cookieOptions(),
			expires: issued.refreshExpiresAt,
		});
	}

	#cookieOptions() {
		return {
			httpOnly: true,
			secure: this.env.NODE_ENV === 'production',
			sameSite: 'lax' as const,
			path: '/auth',
		};
	}
}
