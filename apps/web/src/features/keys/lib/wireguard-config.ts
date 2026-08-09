import type { Device, ExitNodeView } from '@vpn/contracts';

export interface ConfigInput {
	readonly device: Pick<Device, 'tunnelAddress'>;
	readonly node: ExitNodeView;
	readonly privateKey: string;
}

// The client is behind NAT and the node only learns where to answer from the
// last packet it saw, so silence longer than this loses the return path.
const PERSISTENT_KEEPALIVE_SECONDS = 25;

export function buildWireguardConfig({ device, node, privateKey }: ConfigInput): string {
	return [
		'[Interface]',
		`PrivateKey = ${privateKey}`,
		`Address = ${device.tunnelAddress}`,
		'',
		'[Peer]',
		`PublicKey = ${node.publicKey}`,
		`Endpoint = ${node.endpoint}`,
		`AllowedIPs = ${node.allowedIps.join(', ')}`,
		`PersistentKeepalive = ${PERSISTENT_KEEPALIVE_SECONDS}`,
		'',
	].join('\n');
}

export function configFileName(name: string): string {
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 15);

	return `${slug || 'device'}.conf`;
}
