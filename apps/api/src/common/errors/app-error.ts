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
	INTERNAL: 500,
};

export class AppError extends Error {
	readonly code: ApiErrorCode;
	readonly status: number;
	readonly fields: Readonly<Record<string, string>> | undefined;

	constructor(code: ApiErrorCode, message: string, fields?: Record<string, string>) {
		super(message);
		this.name = 'AppError';
		this.code = code;
		this.status = STATUS_BY_CODE[code];
		this.fields = fields;
	}
}

export function statusForCode(code: ApiErrorCode): number {
	return STATUS_BY_CODE[code];
}
