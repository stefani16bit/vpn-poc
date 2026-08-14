#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

// Each node has its own now, and the doctor reads them where the API reads
// them: a value taken from .env would diagnose a node against a credential it
// was never started with.
const CONTROL_REF = (node) => `poc-vpn/exit-node/${node}`;
// a constant on both sides: the node has no user directory
const CONTROL_USER = 'worker';
const COMPOSE = ['compose', '-f', 'devstack/docker-compose.yml'];
// seeded by hand in the devstack and below the .4 the allocator starts at
const FIXTURE_ADDRESS = '10.13.13.2';
// pinned in the compose network, so it can be written down instead of discovered
const CANARY_URL = process.env['CANARY_URL'] || 'http://172.30.13.10';
// the canary node's own end of its tunnel: seeing this instead of a device is
// the POSTROUTING ordering failure, and only that node can produce it
const CANARY_NODE_ADDRESS = '10.13.13.1';
// The control port inside every node. Which host port it is published on is the
// compose file's business, and asking docker is what keeps this script from
// carrying a second copy of the mapping.
const CONTROL_PORT_IN_CONTAINER = '51821';

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

function authorization(token) {
	return `Basic ${Buffer.from(`${CONTROL_USER}:${token}`).toString('base64')}`;
}

function secret(ref) {
	const value = docker([
		'exec',
		'-T',
		'localstack',
		'awslocal',
		'secretsmanager',
		'get-secret-value',
		'--secret-id',
		ref,
		'--query',
		'SecretString',
		'--output',
		'text',
	]);

	return value?.trim() || null;
}

async function control(url, path, headers) {
	try {
		const response = await fetch(`${url}${path}`, {
			signal: AbortSignal.timeout(4000),
			headers,
		});

		return { status: response.status, body: response.ok ? await response.text() : null };
	} catch {
		return { status: 0, body: null };
	}
}

// Discovered from compose rather than listed here: a node added to the devstack
// has to show up in the doctor without anybody remembering to edit this file.
// The published port comes from docker for the same reason.
function fleetServices() {
	const listed = docker(['ps', '--format', '{{.Service}}\t{{.State}}']);
	if (listed === null) return null;

	return listed
		.split('\n')
		.map((line) => line.trim().split('\t'))
		.filter(([service]) => service?.startsWith('wireguard-'))
		.map(([service, state]) => ({
			service,
			name: service.slice('wireguard-'.length),
			running: state === 'running',
			controlUrl: publishedControlUrl(service),
			credential: secret(CONTROL_REF(service.slice('wireguard-'.length))),
		}))
		.sort((left, right) => left.name.localeCompare(right.name));
}

function publishedControlUrl(service) {
	const mapped = docker(['port', service, CONTROL_PORT_IN_CONTAINER]);
	const port = mapped?.trim().split('\n')[0]?.split(':').at(-1);

	return port ? `http://127.0.0.1:${port}` : null;
}

async function probe(url) {
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
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

section('exit nodes');

const fleet = fleetServices();
const peers = new Map();

if (fleet === null) {
	console.log(bad('docker is not answering — is Docker Desktop running?'));
	advise('start Docker Desktop, then `sh devstack/dev.sh up`');
} else if (fleet.length === 0) {
	console.log(bad('no exit node container is running'));
	advise('run `sh devstack/dev.sh up`');
}

for (const node of fleet ?? []) {
	if (!node.running) {
		console.log(bad(`${node.name} — container is not running`));
		advise(`the ${node.name} node is down: any key in that region has nowhere to connect`);
		continue;
	}

	if (!node.controlUrl) {
		console.log(bad(`${node.name} — no published control port`));
		advise(`the ${node.name} node publishes no control port, so the worker cannot provision on it`);
		continue;
	}

	if (!node.credential) {
		console.log(bad(`${node.name} — no credential at ${CONTROL_REF(node.name)}`));
		advise(
			`nothing holds a credential for ${node.name}: seed it with \`sh devstack/dev.sh up\`, or the worker cannot authenticate to that node`,
		);
		continue;
	}

	const described = await control(node.controlUrl, '/cgi-bin/describe', {
		authorization: authorization(node.credential),
	});
	const nodeKey = described.body?.match(/^publicKey=(.+)$/m)?.[1]?.trim() ?? null;

	if (nodeKey) {
		console.log(ok(`${node.name} — answers at ${node.controlUrl}`));
		console.log(`     public key ${DIM}${nodeKey}${OFF}`);
	} else if (described.status === 401) {
		console.log(bad(`${node.name} — refuses the credential ${CONTROL_REF(node.name)} holds`));
		advise(
			`the secret for ${node.name} is not the token that node was started with: recreate the stack with \`sh devstack/dev.sh up\``,
		);
	} else {
		console.log(bad(`${node.name} — control plane is not answering at ${node.controlUrl}`));
		advise(`the worker cannot provision on ${node.name} while its control plane is silent`);
	}

	const anonymous = await control(node.controlUrl, '/cgi-bin/describe', {});

	if (anonymous.status !== 401 && anonymous.status !== 0) {
		console.log(bad(`${node.name} — answered an anonymous caller with ${anonymous.status}`));
		advise(
			`anything that can reach the ${node.name} control plane can add or remove any peer: it is serving without a credential`,
		);
	}

	// Peers are collected per node, because the same tunnel address on two nodes
	// is two different devices and a flat list would call one of them a stranger.
	const wg = docker(['exec', '-T', node.service, 'wg', 'show', 'wg0']);
	let current = null;

	for (const raw of (wg ?? '').split('\n')) {
		const line = raw.trim();
		if (line.startsWith('peer:')) {
			current = `${node.name}|${line.slice(5).trim()}`;
			peers.set(current, {
				node: node.name,
				publicKey: line.slice(5).trim(),
				handshake: null,
				transfer: null,
				allowed: null,
			});
		} else if (current) {
			if (line.startsWith('latest handshake:'))
				peers.get(current).handshake = line.slice(17).trim();
			if (line.startsWith('transfer:')) peers.get(current).transfer = line.slice(9).trim();
			if (line.startsWith('allowed ips:')) peers.get(current).allowed = line.slice(12).trim();
		}
	}
}

// ------------------------------------------------------------ the database

const rows = psql(
	`select d.name, d.tunnel_address, d.public_key, (d.provisioned_at is not null),
		(d.revoked_at is not null), coalesce(n.label, '?')
	from devices d left join exit_nodes n on n.id = d.exit_node_id order by d.created_at`,
);

const devices = (rows ?? []).map((line) => {
	const [name, address, publicKey, provisioned, revoked, node] = line.split('|');
	return {
		name,
		address,
		publicKey,
		node,
		provisioned: provisioned === 't',
		revoked: revoked === 't',
	};
});

const live = devices.filter((device) => !device.revoked);

section(`peers across the fleet (${peers.size})`);
if (peers.size === 0) console.log(`     ${DIM}none${OFF}`);
for (const peer of peers.values()) {
	const owner = live.find((device) => device.publicKey === peer.publicKey);
	const fixture = peer.allowed?.startsWith(`${FIXTURE_ADDRESS}/`);
	const alive = peer.handshake && !/never/i.test(peer.handshake);
	const where = `${peer.node}  ${short(peer.publicKey)}  ${peer.allowed ?? '?'}`;

	if (fixture) {
		console.log(ok(`${where} — the devstack spike fixture`));
	} else if (!owner) {
		console.log(bad(`${where} — no live device owns this peer`));
		advise(
			`the ${peer.node} node serves ${peer.allowed ?? short(peer.publicKey)}, which no live device claims: the reconciler should sweep it`,
		);
	} else {
		console.log((alive ? ok : warn)(`${where} — "${owner.name}"`));
	}

	console.log(`     handshake ${peer.handshake ?? 'never'} · transfer ${peer.transfer ?? '0'}`);
}

section(`devices in the database (${devices.length}, ${live.length} live)`);
if (rows === null) console.log(warn('could not read the database'));
if (devices.length === 0 && rows !== null) console.log(`     ${DIM}none${OFF}`);

for (const device of devices) {
	const onNode = [...peers.values()].some((peer) => peer.publicKey === device.publicKey);

	if (device.revoked) {
		const mark = onNode ? bad : ok;
		console.log(mark(`${device.name} — revoked${onNode ? ', but STILL on a node' : ''}`));
		if (onNode) advise(`a node still serves the revoked device "${device.name}"`);
		continue;
	}

	if (!device.provisioned && !onNode) {
		console.log(warn(`${device.name} — waiting for the worker`));
		advise(`"${device.name}" is still pending; is the worker running? \`pm2 start worker\``);
	} else if (device.provisioned && !onNode) {
		console.log(bad(`${device.name} — marked provisioned but ABSENT from the node`));
		advise(`"${device.name}" is out of sync: the node was rebuilt after it was provisioned`);
	} else if (!device.provisioned && onNode) {
		console.log(bad(`${device.name} — on the node, but never marked provisioned`));
		advise(
			`"${device.name}" works on the node but the database never recorded it: the screen will say it is still being opened up forever`,
		);
	} else {
		console.log(ok(`${device.name} — ${device.address} on ${device.node}`));
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
	const fixture = address === FIXTURE_ADDRESS;

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

// ----------------------------------------------------------------- the canary

section('the canary');

const canaryName = run('docker', [
	'ps',
	'--filter',
	'name=^poc-vpn-canary$',
	'--format',
	'{{.Names}}',
]);
const canaryUp = (canaryName ?? '').trim() !== '';
const tunnelUp = adapters.some((adapter) => adapter.split('|')[1] === 'Up');

if (!canaryUp) {
	console.log(`     ${DIM}not running — it lives in the sibling repo poc-vpn-canary${OFF}`);
} else {
	const answer = await probe(`${CANARY_URL}/api/hello`);
	const seenFrom = answer === null ? null : JSON.parse(answer).seenFrom;

	if (tunnelUp && seenFrom) {
		const owner = live.find((device) => device.address.startsWith(`${seenFrom}/`));
		console.log(ok(`answers through the tunnel, and saw ${seenFrom}`));
		if (owner) console.log(`     that address belongs to ${DIM}"${owner.name}"${OFF}`);
		if (!owner && seenFrom === CANARY_NODE_ADDRESS) {
			console.log(bad('it saw the node, not the device'));
			advise(
				'the canary sees the exit node instead of the device: the RETURN rule is missing or sits after the MASQUERADE one in POSTROUTING',
			);
		}
	} else if (tunnelUp) {
		console.log(bad(`a tunnel is up and ${CANARY_URL} does not answer`));
		advise(
			`the tunnel is active but carries nothing to the canary: check that the .conf AllowedIPs includes 172.30.13.0/24 and regenerate the key if it does not`,
		);
	} else if (seenFrom) {
		console.log(bad('it answers with no tunnel active'));
		advise(
			'the canary answered without a tunnel, so it has a published port: every proof that goes through it is void until the `ports:` mapping is removed',
		);
	} else {
		console.log(ok('unreachable with no tunnel active, which is the whole point'));
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
