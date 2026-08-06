import type { FetchBaseQueryError } from '@reduxjs/toolkit/query';
import type { SerializedError } from '@reduxjs/toolkit';
import type { AnyErrorCode, ApiErrorResponse } from '@vpn/contracts';

export interface NormalizedError {
	readonly code: AnyErrorCode;
	readonly message: string;
	readonly correlationId: string | null;
	readonly status: number | null;
	readonly fields: Readonly<Record<string, string>> | null;
}

function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as ApiErrorResponse).code === 'string' &&
		typeof (value as ApiErrorResponse).correlationId === 'string'
	);
}

export function normalizeError(
	error: FetchBaseQueryError | SerializedError | undefined,
): NormalizedError | null {
	if (!error) return null;

	if ('status' in error) {
		if (typeof error.status === 'number' && isApiErrorResponse(error.data)) {
			return {
				code: error.data.code,
				message: error.data.message,
				correlationId: error.data.correlationId,
				status: error.status,
				fields: error.data.fields ?? null,
			};
		}

		if (error.status === 'FETCH_ERROR') {
			return {
				code: '_NETWORK_ERROR',
				message: 'could not reach the server',
				correlationId: null,
				status: null,
				fields: null,
			};
		}

		if (error.status === 'PARSING_ERROR') {
			return {
				code: '_PARSE_ERROR',
				message: 'the server sent a response we could not read',
				correlationId: null,
				status: typeof error.originalStatus === 'number' ? error.originalStatus : null,
				fields: null,
			};
		}

		return {
			code: '_UNKNOWN_ERROR',
			message: 'an unexpected error occurred',
			correlationId: null,
			status: typeof error.status === 'number' ? error.status : null,
			fields: null,
		};
	}

	return {
		code: '_UNKNOWN_ERROR',
		message: error.message ?? 'an unexpected error occurred',
		correlationId: null,
		status: null,
		fields: null,
	};
}
