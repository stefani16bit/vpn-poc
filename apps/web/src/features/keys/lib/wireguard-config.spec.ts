import { describe, expect, it } from 'vitest';

import { buildWireguardConfig, configFileName } from './wireguard-config.js';

const INPUT = {
	device: { tunnelAddress: '10.13.13.4/32' },
	node: {
		publicKey: 'rKCjjZR5cgoZSG0BE1Cjs5wHcOAOYU5Vweb/Gj0rPWg=',
		endpoint: '127.0.0.1:21820',
		allowedIps: ['10.13.13.0/24'],
	},
	privateKey: 'WJC0KZjD4knUKhixmkOJblemjUjYH/YI2D2E/UhojEc=',
};

describe('buildWireguardConfig', () => {
	it('puts the private key under Interface and the node under Peer, never the reverse', () => {
		const config = buildWireguardConfig(INPUT);
		const [iface, peer] = config.split('[Peer]');

		expect(iface).toContain(`PrivateKey = ${INPUT.privateKey}`);
		expect(peer).toContain(`PublicKey = ${INPUT.node.publicKey}`);
		expect(peer).not.toContain(INPUT.privateKey);
	});

	it('joins several allowed ranges the way the client parses them', () => {
		const config = buildWireguardConfig({
			...INPUT,
			node: { ...INPUT.node, allowedIps: ['10.13.13.0/24', '172.16.0.0/12'] },
		});

		expect(config).toContain('AllowedIPs = 10.13.13.0/24, 172.16.0.0/12');
	});

	it('carries a keepalive, because the node only learns the way back from traffic', () => {
		expect(buildWireguardConfig(INPUT)).toContain('PersistentKeepalive = 25');
	});

	it('ends with a newline, which some clients need to accept the last line', () => {
		expect(buildWireguardConfig(INPUT).endsWith('\n')).toBe(true);
	});
});

describe('configFileName', () => {
	it('slugifies a name a person typed', () => {
		expect(configFileName('Work Laptop')).toBe('work-laptop.conf');
	});

	it('drops characters a filesystem would argue about', () => {
		expect(configFileName('ada/../etc passwd')).toBe('ada-etc-passwd.conf');
	});

	it('falls back rather than producing a file called only an extension', () => {
		expect(configFileName('###')).toBe('device.conf');
	});

	it('keeps the name short enough for the client, which caps the tunnel name', () => {
		expect(configFileName('a'.repeat(40))).toBe(`${'a'.repeat(15)}.conf`);
	});
});
