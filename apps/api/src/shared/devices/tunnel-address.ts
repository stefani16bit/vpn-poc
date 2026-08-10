const FIRST_ASSIGNABLE_HOST = 4;
const LAST_ASSIGNABLE_HOST = 254;
const ASSIGNABLE_HOSTS = LAST_ASSIGNABLE_HOST - FIRST_ASSIGNABLE_HOST + 1;

function prefixOf(cidr: string): string {
	const network = cidr.split('/')[0] ?? '';
	const octets = network.split('.');

	if (octets.length !== 4) {
		throw new Error(`exit node tunnel cidr is not an IPv4 network: ${cidr}`);
	}

	return octets.slice(0, 3).join('.');
}

function addressOf(prefix: string, host: number): string {
	return `${prefix}.${host}/32`;
}

export function* assignableAddresses(
	cidr: string,
	startAt = FIRST_ASSIGNABLE_HOST,
): Generator<string> {
	const prefix = prefixOf(cidr);
	const from =
		startAt >= FIRST_ASSIGNABLE_HOST && startAt <= LAST_ASSIGNABLE_HOST
			? startAt
			: FIRST_ASSIGNABLE_HOST;
	const offset = from - FIRST_ASSIGNABLE_HOST;

	for (let step = 0; step < ASSIGNABLE_HOSTS; step += 1) {
		yield addressOf(prefix, FIRST_ASSIGNABLE_HOST + ((offset + step) % ASSIGNABLE_HOSTS));
	}
}

export function firstFreeHost(cidr: string, taken: ReadonlySet<string>): number {
	const prefix = prefixOf(cidr);

	for (let host = FIRST_ASSIGNABLE_HOST; host <= LAST_ASSIGNABLE_HOST; host += 1) {
		if (!taken.has(addressOf(prefix, host))) return host;
	}

	return FIRST_ASSIGNABLE_HOST;
}

export function isAssignable(address: string, cidr: string): boolean {
	const [network, mask] = address.split('/');
	if (mask !== '32' || !network) return false;

	const octets = network.split('.');
	if (octets.length !== 4) return false;

	const host = Number(octets[3]);
	if (!Number.isInteger(host) || host < FIRST_ASSIGNABLE_HOST || host > LAST_ASSIGNABLE_HOST) {
		return false;
	}

	return octets.slice(0, 3).join('.') === prefixOf(cidr);
}
