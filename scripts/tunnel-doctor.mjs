#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

const CONTROL_URL = process.env['EXIT_NODE_API_URL'] ?? 'http://127.0.0.1:21821';
const COMPOSE = ['compose', '-f', 'devstack/docker-compose.yml'];

const GREEN = '[32m';
const RED = '[31m';
const YELLOW = '[33m';
const DIM = '[2m';
const OFF = '[0m';

const ok = (text) => `${GREEN}ok${OFF}   ${text}`;
const bad = (text) => `${RED}BAD${OFF}  ${text}`;
const warn = (text) => `${YELLOW}warn${OFF} ${text}`;

const short = (key) => (key ? `${key.slice(0, 12)}…` : '(none)');

function run(file, args) {
	try {
		return execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
	} catch {
		return null;
	}
}

function docker(args) {
	return run('docker', [...COMPOSE, ...args]);
}

function psql(sql) {
	const out = docker([
		'exec',
		'-T',
		'postgres',
		'psql',
		'-U',
		'postgres',
		'-d',
		'poc_vpn_dev',
		'-tAc',
		`set role app_system; ${sql}`,
	]);
	if (out === null) return null;
	return out
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line && line !== 'SET');
}

function powershell(script) {
	const out = run('powershell.exe', ['-NoProfile', '-Command', script]);
	return out === null
		? []
		: out
				.split('\n')
				.map((line) => line.trim())
				.filter(Boolean);
}

async function control(path) {
	try {
		const response = await fetch(`${CONTROL_URL}${path}`, { signal: AbortSignal.timeout(4000) });
		return response.ok ? await response.text() : null;
	} catch {
		return null;
	}
}

function section(title) {
	console.log(`\n${title}`);
}

const problems = [];
const advise = (line) => problems.push(line);

// ---------------------------------------------------------------- the node

section('exit node');

const state = docker(['ps', '--format', '{{.Service}}\t{{.State}}']);
const nodeUp = state?.split('\n').some((line) => line.startsWith('wireguard\trunning'));

if (state === null) {
	console.log(bad('docker is not answering — is Docker Desktop running?'));
	advise('start Docker Desktop, then `sh devstack/dev.sh up`');
} else if (!nodeUp) {
	console.log(bad('the wireguard container is not running'));
	advise('run `sh devstack/dev.sh up`');
} else {
	console.log(ok('container running'));
}

const described = await control('/cgi-bin/describe');
const nodeKey = described?.match(/^publicKey=(.+)$/m)?.[1]?.trim() ?? null;

if (nodeKey) {
	console.log(ok(`control plane answers at ${CONTROL_URL}`));
	console.log(`     public key ${DIM}${nodeKey}${OFF}`);
} else if (nodeUp) {
	console.log(bad(`control plane is not answering at ${CONTROL_URL}`));
	advise('the worker cannot provision while the control plane is silent');
}

const wg = docker(['exec', '-T', 'wireguard', 'wg', 'show', 'wg0']);
const peers = new Map();

if (wg) {
	let current = null;
	for (const raw of wg.split('\n')) {
		const line = raw.trim();
		if (line.startsWith('peer:')) {
			current = line.slice(5).trim();
			peers.set(current, { handshake: null, transfer: null, allowed: null });
		} else if (current) {
			if (line.startsWith('latest handshake:'))
				peers.get(current).handshake = line.slice(17).trim();
			if (line.startsWith('transfer:')) peers.get(current).transfer = line.slice(9).trim();
			if (line.startsWith('allowed ips:')) peers.get(current).allowed = line.slice(12).trim();
		}
	}
}

section(`peers on the node (${peers.size})`);
if (peers.size === 0) console.log(`     ${DIM}none${OFF}`);
for (const [key, peer] of peers) {
	const alive = peer.handshake && !/never/i.test(peer.handshake);
	const moving = peer.transfer && !/^0 B received, 0 B sent$/.test(peer.transfer);
	const mark = alive && moving ? ok : alive ? warn : bad;
	console.log(mark(`${short(key)}  ${peer.allowed ?? '?'}`));
	console.log(`     handshake ${peer.handshake ?? 'never'} · transfer ${peer.transfer ?? '0'}`);
}

// ------------------------------------------------------------ the database

const rows = psql(
	'select name, tunnel_address, public_key, (provisioned_at is not null), (revoked_at is not null) from devices order by created_at',
);

const devices = (rows ?? []).map((line) => {
	const [name, address, publicKey, provisioned, revoked] = line.split('|');
	return {
		name,
		address,
		publicKey,
		provisioned: provisioned === 't',
		revoked: revoked === 't',
	};
});

const live = devices.filter((device) => !device.revoked);

section(`devices in the database (${devices.length}, ${live.length} live)`);
if (rows === null) console.log(warn('could not read the database'));
if (devices.length === 0 && rows !== null) console.log(`     ${DIM}none${OFF}`);

for (const device of devices) {
	const onNode = peers.has(device.publicKey);

	if (device.revoked) {
		const mark = onNode ? bad : ok;
		console.log(mark(`${device.name} — revoked${onNode ? ', but STILL on the node' : ''}`));
		if (onNode) advise(`the node still serves the revoked device "${device.name}"`);
		continue;
	}

	if (!device.provisioned && !onNode) {
		console.log(warn(`${device.name} — waiting for the worker`));
		advise(`"${device.name}" is still pending; is the worker running? \`pm2 start worker\``);
	} else if (device.provisioned && !onNode) {
		console.log(bad(`${device.name} — marked provisioned but ABSENT from the node`));
		advise(`"${device.name}" is out of sync: the node was rebuilt after it was provisioned`);
	} else {
		console.log(ok(`${device.name} — ${device.address} on the node`));
	}
}

// -------------------------------------------------------- the windows side

section('tunnels on this machine');

const adapters = powershell(
	"Get-NetAdapter | Where-Object { $_.InterfaceDescription -like '*WireGuard*' } | ForEach-Object { $_.Name + '|' + $_.Status }",
);

if (adapters.length === 0) console.log(`     ${DIM}none active${OFF}`);

for (const adapter of adapters) {
	const [name, status] = adapter.split('|');
	const addresses = powershell(
		`Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias '${name}' -ErrorAction SilentlyContinue | ForEach-Object { $_.IPAddress }`,
	);
	const address = addresses[0] ?? '?';
	const match = live.find((device) => device.address.startsWith(`${address}/`));
	const fixture = address === '10.13.13.2';

	if (match) {
		console.log(ok(`${name} (${status}) — ${address} → device "${match.name}"`));
	} else if (fixture) {
		console.log(ok(`${name} (${status}) — ${address} → the devstack spike fixture`));
	} else {
		console.log(bad(`${name} (${status}) — ${address} matches no live device`));
		advise(
			`tunnel "${name}" points at ${address}, which no live device owns: it was revoked or the database was reset. Delete it in the WireGuard app and generate a new one.`,
		);
	}
}

// ------------------------------------------------------------------ verdict

section('verdict');
if (problems.length === 0) {
	console.log(ok('everything lines up'));
} else {
	for (const problem of problems) console.log(bad(problem));
}
console.log();
