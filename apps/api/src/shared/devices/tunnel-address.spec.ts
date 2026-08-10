import { describe, expect, it } from 'vitest';

import { assignableAddresses, firstFreeHost, isAssignable } from './tunnel-address.js';

const CIDR = '10.13.13.0/24';

describe('assignableAddresses', () => {
	it('starts at .4, because the node and the spike fixture hold the ones below', () => {
		const [first] = assignableAddresses(CIDR);
		expect(first).toBe('10.13.13.4/32');
	});

	it('offers every host the range has, once', () => {
		const all = [...assignableAddresses(CIDR)];

		expect(all).toHaveLength(251);
		expect(new Set(all).size).toBe(251);
		expect(all.at(-1)).toBe('10.13.13.254/32');
	});

	it('starts where it was told to', () => {
		const [first] = assignableAddresses(CIDR, 200);
		expect(first).toBe('10.13.13.200/32');
	});

	it('wraps back to .4, so a hint never shrinks the range', () => {
		const all = [...assignableAddresses(CIDR, 200)];

		expect(all).toHaveLength(251);
		expect(new Set(all).size).toBe(251);
		expect(all[54]).toBe('10.13.13.254/32');
		expect(all[55]).toBe('10.13.13.4/32');
	});

	it('ignores a hint outside the range rather than yielding nothing', () => {
		expect([...assignableAddresses(CIDR, 999)]).toHaveLength(251);
		expect([...assignableAddresses(CIDR, 0)]).toHaveLength(251);
	});

	it('refuses a cidr that is not an IPv4 network', () => {
		expect(() => [...assignableAddresses('not-a-cidr')]).toThrow('IPv4 network');
	});
});

describe('firstFreeHost', () => {
	it('answers .4 when nothing is taken', () => {
		expect(firstFreeHost(CIDR, new Set())).toBe(4);
	});

	it('skips the run that is taken', () => {
		const taken = new Set([...assignableAddresses(CIDR)].slice(0, 197));
		expect(firstFreeHost(CIDR, taken)).toBe(201);
	});

	it('finds the hole rather than the end', () => {
		const taken = new Set([...assignableAddresses(CIDR)].slice(0, 197));
		taken.delete('10.13.13.9/32');

		expect(firstFreeHost(CIDR, taken)).toBe(9);
	});

	it('falls back to .4 when the range is full, so the loop still decides', () => {
		expect(firstFreeHost(CIDR, new Set(assignableAddresses(CIDR)))).toBe(4);
	});
});

describe('isAssignable', () => {
	it('claims the range it hands out', () => {
		expect(isAssignable('10.13.13.4/32', CIDR)).toBe(true);
		expect(isAssignable('10.13.13.254/32', CIDR)).toBe(true);
	});

	it('disowns the devstack spike fixture and everything below the range', () => {
		expect(isAssignable('10.13.13.2/32', CIDR)).toBe(false);
		expect(isAssignable('10.13.13.1/32', CIDR)).toBe(false);
	});

	it('disowns an address from another network', () => {
		expect(isAssignable('10.99.99.7/32', CIDR)).toBe(false);
	});

	it('disowns what it cannot read', () => {
		expect(isAssignable('nonsense', CIDR)).toBe(false);
		expect(isAssignable('10.13.13.4', CIDR)).toBe(false);
	});
});
