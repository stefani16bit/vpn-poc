import { describe, expect, it } from 'vitest';

import { API_MODULES, MODULE_BY_ROUTE_PREFIX, moduleForUrl } from './api-module.js';

describe('api module', () => {
	it('attributes a route to the module that owns its prefix', () => {
		expect(moduleForUrl('/auth/login')).toBe('auth');
		expect(moduleForUrl('/billing/webhook')).toBe('billing');
		expect(moduleForUrl('/health/ready')).toBe('health');
	});

	it('attributes the prefix itself, not just what is below it', () => {
		expect(moduleForUrl('/health')).toBe('health');
		expect(moduleForUrl('/health/')).toBe('health');
	});

	it('ignores the query string', () => {
		expect(moduleForUrl('/auth/verify-email?token=abc')).toBe('auth');
	});

	it('matches on the prefix, not anywhere in the path', () => {
		expect(moduleForUrl('/x/auth')).toBe('http');
		expect(moduleForUrl('/authorization')).toBe('http');
	});

	it('falls back to http for an unmapped route', () => {
		expect(moduleForUrl('/')).toBe('http');
		expect(moduleForUrl(undefined)).toBe('http');
	});

	it('maps every prefix to a declared module', () => {
		for (const [, module] of MODULE_BY_ROUTE_PREFIX) {
			expect(API_MODULES).toContain(module);
		}
	});
});
