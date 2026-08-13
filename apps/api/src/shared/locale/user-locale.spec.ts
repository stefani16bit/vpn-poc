import { describe, expect, it } from 'vitest';

import { FALLBACK_LOCALE } from '@vpn/contracts';

import { runWithCorrelation, runWithContext } from '../http/request-context.js';
import { localeOf } from './user-locale.js';

describe('localeOf', () => {
	it('prefers the locale on the account', () => {
		runWithContext(
			{ correlationId: 'c', locale: 'en', module: 'system', ip: null, tenant: null },
			() => {
				expect(localeOf({ locale: 'pt-BR' })).toBe('pt-BR');
			},
		);
	});

	it('falls back to the negotiated request locale when the account has none', () => {
		runWithContext(
			{ correlationId: 'c', locale: 'en', module: 'system', ip: null, tenant: null },
			() => {
				expect(localeOf({ locale: '' })).toBe('en');
			},
		);
	});

	it('falls back to the negotiated locale when the account locale is not supported', () => {
		runWithContext(
			{ correlationId: 'c', locale: 'en', module: 'system', ip: null, tenant: null },
			() => {
				expect(localeOf({ locale: 'kl-GL' })).toBe('en');
			},
		);
	});

	it('falls back to FALLBACK_LOCALE outside a request', () => {
		expect(localeOf({ locale: 'kl-GL' })).toBe(FALLBACK_LOCALE);
	});

	it('still honours the account locale outside a request', () => {
		expect(localeOf({ locale: 'en' })).toBe('en');
	});

	it('falls back to FALLBACK_LOCALE when the context carries no usable locale', () => {
		runWithCorrelation('c', () => {
			expect(localeOf({ locale: 'kl-GL' })).toBe(FALLBACK_LOCALE);
		});
	});
});
