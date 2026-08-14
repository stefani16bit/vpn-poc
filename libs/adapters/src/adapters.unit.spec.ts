import { describe, expect, it } from 'vitest';

import { renderEmail, renderSms } from './email/render.js';
import { HttpExitNode } from './network/HttpExitNode.js';
import { NoopErrorReporter, SENSITIVE_KEYS, redactObject } from './observability/reporters.js';

describe('renderEmail', () => {
	it('interpolates the link into a verification mail', () => {
		const rendered = renderEmail('verify_email', 'pt-BR', {
			url: 'https://app.localhost/verify-email?token=abc',
			expiresInHours: '24',
		});

		expect(rendered.subject).toBe('Confirme seu e-mail');
		expect(rendered.text).toContain('https://app.localhost/verify-email?token=abc');
		expect(rendered.text).toContain('24 horas');
	});

	it('renders English when the locale asks for it', () => {
		expect(renderEmail('verify_email', 'en', {}).subject).toBe('Confirm your e-mail');
	});

	it('falls back to pt-BR for a locale we do not carry', () => {
		expect(renderEmail('verify_email', 'fr-FR', {}).subject).toBe('Confirme seu e-mail');
	});

	it('renders an SMS body from the same catalogue', () => {
		expect(renderSms('verify_phone', 'en', { code: '123456' })).toContain('123456');
	});

	it('renders a template that exists in both locales', () => {
		expect(renderEmail('welcome', 'en', {}).subject).toBe('Your account is active');
	});

	it('renders every template in the union without throwing', () => {
		const templates = [
			'verify_email',
			'reset_password',
			'password_changed',
			'welcome',
			'payment_failed',
			'subscription_activated',
			'subscription_cancel_scheduled',
			'subscription_resumed',
			'subscription_canceled',
			'access_revoked',
		] as const;

		for (const template of templates) {
			const rendered = renderEmail(template, 'pt-BR', {});
			expect(rendered.subject).not.toContain(`email.${template}`);
			expect(rendered.text).not.toContain(`email.${template}`);
			expect(rendered.subject.length).toBeGreaterThan(0);
			expect(rendered.text.length).toBeGreaterThan(0);
		}
	});

	it('does not leak the string "undefined" when a variable is missing', () => {
		expect(renderEmail('reset_password', 'pt-BR', {}).text).not.toContain('undefined');
	});
});

describe('redactObject', () => {
	it('redacts a sensitive key', () => {
		expect(redactObject({ password: 'hunter2' })).toEqual({ password: '[REDACTED]' });
	});

	it('matches case-insensitively, because header names arrive lowercased', () => {
		expect(redactObject({ Authorization: 'Bearer x' })).toEqual({ Authorization: '[REDACTED]' });
	});

	it('reaches into nested objects', () => {
		expect(redactObject({ user: { email: 'ada@example.com', password: 'hunter2' } })).toEqual({
			user: { email: 'ada@example.com', password: '[REDACTED]' },
		});
	});

	it('leaves harmless values alone', () => {
		expect(redactObject({ email: 'ada@example.com', count: 3 })).toEqual({
			email: 'ada@example.com',
			count: 3,
		});
	});

	it('covers the token names the auth flows actually use', () => {
		for (const key of ['token', 'accessToken', 'refreshToken', 'resetToken', 'otp']) {
			expect(SENSITIVE_KEYS).toContain(key);
		}
	});
});

describe('HttpExitNode', () => {
	const options = {
		apiUrl: 'http://127.0.0.1:21821',
		endpoint: '127.0.0.1:21820',
		allowedIps: ['10.13.13.0/24'],
	};

	it('refuses to be built without a credential, so the registry cannot fall back to anonymous', () => {
		expect(() => new HttpExitNode({ ...options, token: '' })).toThrow(/credential/i);
	});

	it('accepts a credential', () => {
		expect(() => new HttpExitNode({ ...options, token: 'x'.repeat(32) })).not.toThrow();
	});
});

describe('NoopErrorReporter', () => {
	it('accepts a capture without throwing', () => {
		expect(() => new NoopErrorReporter().capture(new Error('boom'))).not.toThrow();
	});
});
