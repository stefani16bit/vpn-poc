import type { ApiErrorCode } from '@vpn/contracts';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
	VALIDATION_FAILED: 400,
	INVALID_CREDENTIALS: 401,
	EMAIL_NOT_VERIFIED: 403,
	TOKEN_INVALID: 400,
	TOKEN_EXPIRED: 400,
	SESSION_REUSE_DETECTED: 401,
	RATE_LIMITED: 429,
	UNAUTHENTICATED: 401,
	FORBIDDEN: 403,
	NOT_FOUND: 404,
	CONFLICT: 409,
	PAYMENT_REQUIRED: 402,
	// The company bought a plan; this is its ceiling, not a missing subscription.
	QUOTA_EXCEEDED: 402,
	INTERNAL: 500,
};

export interface AppErrorOptions {
	readonly retryAfterSeconds?: number;
}

export class AppError extends Error {
	readonly code: ApiErrorCode;
	readonly status: number;
	readonly fields: Readonly<Record<string, string>> | undefined;
	readonly retryAfterSeconds: number | undefined;

	constructor(
		code: ApiErrorCode,
		message: string,
		fields?: Record<string, string>,
		options?: AppErrorOptions,
	) {
		super(message);
		this.name = 'AppError';
		this.code = code;
		this.status = STATUS_BY_CODE[code];
		this.fields = fields;
		this.retryAfterSeconds = options?.retryAfterSeconds;
	}
}

export function statusForCode(code: ApiErrorCode): number {
	return STATUS_BY_CODE[code];
}
