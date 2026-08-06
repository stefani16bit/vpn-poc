import { describe, expect, it } from 'vitest';

import { registerRequestSchema } from '@vpn/contracts';

import { AppError } from '../errors/app-error.js';
import { ZodBody } from './zod-body.pipe.js';

describe('ZodBody', () => {
	const pipe = new ZodBody(registerRequestSchema);

	it('returns the parsed value, normalised', () => {
		const parsed = pipe.transform(
			{ email: '  Ada@Example.COM ', password: 'a-sufficiently-long-password' },
			{ type: 'body' },
		);
		expect(parsed.email).toBe('ada@example.com');
	});

	it('throws VALIDATION_FAILED with one message per field', () => {
		try {
			pipe.transform({ email: 'not-an-email', password: 'short' }, { type: 'body' });
			expect.unreachable('should have thrown');
		} catch (error) {
			expect(error).toBeInstanceOf(AppError);
			const appError = error as AppError;
			expect(appError.code).toBe('VALIDATION_FAILED');
			expect(appError.fields).toHaveProperty('email');
			expect(appError.fields).toHaveProperty('password');
		}
	});

	it('keeps the first message when a field has several problems', () => {
		try {
			pipe.transform({ email: '', password: '' }, { type: 'body' });
			expect.unreachable('should have thrown');
		} catch (error) {
			const fields = (error as AppError).fields ?? {};
			expect(typeof fields['email']).toBe('string');
		}
	});
});
