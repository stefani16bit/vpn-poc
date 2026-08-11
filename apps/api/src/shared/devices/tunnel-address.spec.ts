import { describe, expect, it } from 'vitest';

import { assignableAddresses, firstFreeAddress, isAssignable } from './tunnel-address.js';

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
		const [first] = assignableAddresses(CIDR, '10.13.13.200/32');
		expect(first).toBe('10.13.13.200/32');
	});

	it('wraps back to .4, so a hint never shrinks the range', () => {
		const all = [...assignableAddresses(CIDR, '10.13.13.200/32')];

		expect(all).toHaveLength(251);
		expect(new Set(all).size).toBe(251);
		expect(all[54]).toBe('10.13.13.254/32');
		expect(all[55]).toBe('10.13.13.4/32');
	});

	it('ignores a hint outside the range rather than yielding nothing', () => {
		expect([...assignableAddresses(CIDR, '10.99.99.9/32')]).toHaveLength(251);
		expect([...assignableAddresses(CIDR, '10.13.13.0/32')]).toHaveLength(251);
		expect([...assignableAddresses(CIDR, 'nonsense')]).toHaveLength(251);
	});

	it('refuses a cidr that is not an IPv4 network', () => {
		expect(() => [...assignableAddresses('not-a-cidr')]).toThrow('IPv4 network');
	});

	it('stops at the broadcast of a /25 instead of running into the half it does not own', () => {
		const all = [...assignableAddresses('10.13.13.0/25')];

		expect(all).toHaveLength(123);
		expect(all[0]).toBe('10.13.13.4/32');
		expect(all.at(-1)).toBe('10.13.13.126/32');
		expect(all).not.toContain('10.13.13.128/32');
		expect(all).not.toContain('10.13.13.254/32');
	});

	it('crosses octets when the prefix is shorter than 24', () => {
		const all = [...assignableAddresses('10.13.0.0/16')];

		expect(all).toHaveLength(65531);
		expect(all[0]).toBe('10.13.0.4/32');
		expect(all).toContain('10.13.1.0/32');
		expect(all.at(-1)).toBe('10.13.255.254/32');
	});

	it('reads the network address rather than trusting the octets given', () => {
		const [first] = assignableAddresses('10.13.13.130/25');
		expect(first).toBe('10.13.13.132/32');
	});

	it('refuses a range with no room for a host, instead of yielding nothing', () => {
		expect(() => [...assignableAddresses('10.13.13.0/30')]).toThrow('no assignable host');
	});

	it('refuses a prefix length that is not a mask', () => {
		expect(() => [...assignableAddresses('10.13.13.0/33')]).toThrow('IPv4 network');
	});
});

describe('firstFreeAddress', () => {
	it('answers .4 when nothing is taken', () => {
		expect(firstFreeAddress(CIDR, new Set())).toBe('10.13.13.4/32');
	});

	it('skips the run that is taken', () => {
		const taken = new Set([...assignableAddresses(CIDR)].slice(0, 197));
		expect(firstFreeAddress(CIDR, taken)).toBe('10.13.13.201/32');
	});

	it('finds the hole rather than the end', () => {
		const taken = new Set([...assignableAddresses(CIDR)].slice(0, 197));
		taken.delete('10.13.13.9/32');

		expect(firstFreeAddress(CIDR, taken)).toBe('10.13.13.9/32');
	});

	it('falls back to the first when the range is full, so the loop still decides', () => {
		expect(firstFreeAddress(CIDR, new Set(assignableAddresses(CIDR)))).toBe('10.13.13.4/32');
	});

	it('answers in the range it was given, not in a /24 of it', () => {
		const taken = new Set([...assignableAddresses('10.13.13.0/25')]);
		expect(firstFreeAddress('10.13.13.0/25', taken)).toBe('10.13.13.4/32');
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

	it('disowns the half of a /25 the allocator never hands out', () => {
		expect(isAssignable('10.13.13.126/32', '10.13.13.0/25')).toBe(true);
		expect(isAssignable('10.13.13.128/32', '10.13.13.0/25')).toBe(false);
		expect(isAssignable('10.13.13.200/32', '10.13.13.0/25')).toBe(false);
	});

	it('claims across octets when the prefix is shorter than 24', () => {
		expect(isAssignable('10.13.200.7/32', '10.13.0.0/16')).toBe(true);
		expect(isAssignable('10.14.0.7/32', '10.13.0.0/16')).toBe(false);
	});

	it('disowns the broadcast address of the range', () => {
		expect(isAssignable('10.13.13.255/32', CIDR)).toBe(false);
	});
});
