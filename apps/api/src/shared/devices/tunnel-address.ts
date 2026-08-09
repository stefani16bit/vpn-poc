const FIRST_ASSIGNABLE_HOST = 4;
const LAST_ASSIGNABLE_HOST = 254;

export function* assignableAddresses(cidr: string): Generator<string> {
	const network = cidr.split('/')[0] ?? '';
	const octets = network.split('.');

	if (octets.length !== 4) {
		throw new Error(`exit node tunnel cidr is not an IPv4 network: ${cidr}`);
	}

	const prefix = octets.slice(0, 3).join('.');

	for (let host = FIRST_ASSIGNABLE_HOST; host <= LAST_ASSIGNABLE_HOST; host += 1) {
		yield `${prefix}.${host}/32`;
	}
}
