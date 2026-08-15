import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readIntendedCadence, storeIntendedCadence } from './intended-cadence.js';

const STORAGE_KEY = 'poc-vpn.cadence';
const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
	window.localStorage.clear();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe('intended cadence', () => {
	it('hands back the cadence chosen before the account existed', () => {
		storeIntendedCadence('yearly');

		expect(readIntendedCadence()).toBe('yearly');
	});

	it('says nothing when nobody chose anything', () => {
		expect(readIntendedCadence()).toBeNull();
	});

	it('says nothing when the stored value is not a cadence we sell', () => {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ cadence: 'weekly', at: Date.now() }));

		expect(readIntendedCadence()).toBeNull();
	});

	it('says nothing when the entry is not readable at all', () => {
		window.localStorage.setItem(STORAGE_KEY, 'not json');

		expect(readIntendedCadence()).toBeNull();
	});

	it('says nothing when the entry carries no timestamp', () => {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ cadence: 'monthly' }));

		expect(readIntendedCadence()).toBeNull();
	});

	it('forgets a choice that outlived the verification link it travelled with', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-15T12:00:00.000Z'));
		storeIntendedCadence('monthly');

		vi.setSystemTime(new Date('2026-08-15T12:00:00.000Z').getTime() + DAY_MS + 1000);

		expect(readIntendedCadence()).toBeNull();
	});

	it('keeps a choice that is still inside that window', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-15T12:00:00.000Z'));
		storeIntendedCadence('monthly');

		vi.setSystemTime(new Date('2026-08-15T12:00:00.000Z').getTime() + DAY_MS - 1000);

		expect(readIntendedCadence()).toBe('monthly');
	});

	it('costs one click, not a crash, in a browser that refuses storage', () => {
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('storage disabled');
		});
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('storage disabled');
		});

		expect(() => storeIntendedCadence('yearly')).not.toThrow();
		expect(readIntendedCadence()).toBeNull();
	});
});
