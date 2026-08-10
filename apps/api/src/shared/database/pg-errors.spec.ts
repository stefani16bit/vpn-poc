import { describe, expect, it } from 'vitest';

import { isUniqueViolation } from './pg-errors.js';

const DUPLICATE_KEY = { code: '23505', constraint_name: 'devices_live_public_key_key' };

describe('isUniqueViolation', () => {
	it('recognises the constraint that refused the insert', () => {
		expect(isUniqueViolation(DUPLICATE_KEY, 'devices_live_public_key_key')).toBe(true);
	});

	it('does not answer for a different constraint, because they mean different things', () => {
		expect(isUniqueViolation(DUPLICATE_KEY, 'devices_live_address_key')).toBe(false);
	});

	it('does not answer for a different sqlstate', () => {
		const foreignKey = { code: '23503', constraint_name: 'devices_live_public_key_key' };
		expect(isUniqueViolation(foreignKey, 'devices_live_public_key_key')).toBe(false);
	});

	it('survives anything a catch block may actually receive', () => {
		expect(isUniqueViolation(new Error('boom'), 'devices_live_public_key_key')).toBe(false);
		expect(isUniqueViolation(null, 'devices_live_public_key_key')).toBe(false);
		expect(isUniqueViolation(undefined, 'devices_live_public_key_key')).toBe(false);
		expect(isUniqueViolation('23505', 'devices_live_public_key_key')).toBe(false);
	});
});
