export interface PlatformNode {
	readonly slug: string;
	readonly regionId: string;
	readonly regionName: string;
	readonly nodeId: string;
	readonly label: string;
	readonly endpoint: string;
	readonly controlUrl: string;
	readonly publicKey: string;
	readonly tunnelCidr: string;
	readonly credentialRef: string;
}

// The fleet we operate, and the source the seed migration is transcribed from.
// The ids are fixed rather than generated so a test can name a node without
// reading it back first, and so a seed that drifts from this file fails to
// compile instead of failing a foreign key on the fortieth test.
//
// The public keys are the ones these machines answer with; their private halves
// are versioned beside them in devstack/wireguard/nodes. `make check` compares
// each one against what the node reports, per node, on every run.
export const PLATFORM_FLEET: readonly PlatformNode[] = [
	{
		slug: 'sa',
		regionId: 'f1ee7000-0000-4000-8000-000000000001',
		regionName: 'South America',
		nodeId: 'f1ee7000-0000-4000-8000-000000000011',
		label: 'sa-01',
		endpoint: '127.0.0.1:21820',
		controlUrl: 'http://127.0.0.1:21821',
		publicKey: 'rKCjjZR5cgoZSG0BE1Cjs5wHcOAOYU5Vweb/Gj0rPWg=',
		tunnelCidr: '10.13.13.0/24',
		credentialRef: 'poc-vpn/exit-node/sa',
	},
	{
		slug: 'na',
		regionId: 'f1ee7000-0000-4000-8000-000000000002',
		regionName: 'North America',
		nodeId: 'f1ee7000-0000-4000-8000-000000000012',
		label: 'na-01',
		endpoint: '127.0.0.1:21830',
		controlUrl: 'http://127.0.0.1:21831',
		publicKey: 'l9q1kct/2KO4JeXyFdwLgv0hjmSAlKtx4IphTAyPDlk=',
		tunnelCidr: '10.13.14.0/24',
		credentialRef: 'poc-vpn/exit-node/na',
	},
	{
		slug: 'eu',
		regionId: 'f1ee7000-0000-4000-8000-000000000003',
		regionName: 'Europe',
		nodeId: 'f1ee7000-0000-4000-8000-000000000013',
		label: 'eu-01',
		endpoint: '127.0.0.1:21840',
		controlUrl: 'http://127.0.0.1:21841',
		publicKey: '6WeATIWyV+4hSkrG+IeOjkptYhWMXiMKCvgKME63wm0=',
		tunnelCidr: '10.13.15.0/24',
		credentialRef: 'poc-vpn/exit-node/eu',
	},
	{
		slug: 'as',
		regionId: 'f1ee7000-0000-4000-8000-000000000004',
		regionName: 'Asia',
		nodeId: 'f1ee7000-0000-4000-8000-000000000014',
		label: 'as-01',
		endpoint: '127.0.0.1:21850',
		controlUrl: 'http://127.0.0.1:21851',
		publicKey: 'ERBj22MetQp6YlY0nyaJ9v14aze22A9w2GKU8IPTTXI=',
		tunnelCidr: '10.13.16.0/24',
		credentialRef: 'poc-vpn/exit-node/as',
	},
	{
		slug: 'af',
		regionId: 'f1ee7000-0000-4000-8000-000000000005',
		regionName: 'Africa',
		nodeId: 'f1ee7000-0000-4000-8000-000000000015',
		label: 'af-01',
		endpoint: '127.0.0.1:21860',
		controlUrl: 'http://127.0.0.1:21861',
		publicKey: 'wB8vw5IyH2ifpbQuW0rcRjZSY4dTV3ZO2M5x1mMSVDk=',
		tunnelCidr: '10.13.17.0/24',
		credentialRef: 'poc-vpn/exit-node/af',
	},
];

export function platformNode(slug: string): PlatformNode {
	const found = PLATFORM_FLEET.find((node) => node.slug === slug);
	if (!found) throw new Error(`no platform node with slug ${slug}`);

	return found;
}
