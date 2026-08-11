// .0 is the network, .1 is the node itself and .2 is the devstack spike fixture,
// so the allocator starts four past the network address.
const FIRST_ASSIGNABLE_OFFSET = 4;

interface Range {
	readonly first: number;
	readonly last: number;
}

function toInt(dotted: string): number | null {
	const octets = dotted.split('.');
	if (octets.length !== 4) return null;

	let value = 0;
	for (const octet of octets) {
		if (!/^\d{1,3}$/.test(octet)) return null;

		const part = Number(octet);
		if (part > 255) return null;

		value = value * 256 + part;
	}

	return value;
}

function toDotted(value: number): string {
	return [24, 16, 8, 0].map((shift) => ((value / 2 ** shift) % 256) | 0).join('.');
}

function rangeOf(cidr: string): Range {
	const [network, prefix] = cidr.split('/');
	const base = network === undefined ? null : toInt(network);
	const bits = prefix === undefined || !/^\d{1,2}$/.test(prefix) ? null : Number(prefix);

	if (base === null || bits === null || bits > 32) {
		throw new Error(`exit node tunnel cidr is not an IPv4 network: ${cidr}`);
	}

	const size = 2 ** (32 - bits);
	const start = base - (base % size);
	const first = start + FIRST_ASSIGNABLE_OFFSET;
	const last = start + size - 2;

	if (first > last) {
		throw new Error(`exit node tunnel cidr has no assignable host: ${cidr}`);
	}

	return { first, last };
}

function addressOf(value: number): string {
	return `${toDotted(value)}/32`;
}

function hostOf(address: string): number | null {
	const [network, mask] = address.split('/');
	if (mask !== '32' || network === undefined) return null;

	return toInt(network);
}

export function* assignableAddresses(cidr: string, startAt?: string): Generator<string> {
	const { first, last } = rangeOf(cidr);
	const size = last - first + 1;

	const hinted = startAt === undefined ? null : hostOf(startAt);
	const from = hinted !== null && hinted >= first && hinted <= last ? hinted : first;
	const offset = from - first;

	for (let step = 0; step < size; step += 1) {
		yield addressOf(first + ((offset + step) % size));
	}
}

export function firstFreeAddress(cidr: string, taken: ReadonlySet<string>): string {
	const { first, last } = rangeOf(cidr);

	for (let value = first; value <= last; value += 1) {
		const address = addressOf(value);
		if (!taken.has(address)) return address;
	}

	return addressOf(first);
}

export function isAssignable(address: string, cidr: string): boolean {
	const host = hostOf(address);
	if (host === null) return false;

	const { first, last } = rangeOf(cidr);

	return host >= first && host <= last;
}
