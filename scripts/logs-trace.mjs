#!/usr/bin/env node
/**
 * Replays one request out of the NDJSON log written by LOG_TRANSPORT=pretty|file.
 *
 * The pretty stream on stdout is for watching; this is for answering "what
 * happened during that request", which needs the whole trace in order and long
 * after the scrollback is gone.
 *
 * Usage:
 *   pnpm logs:trace                    list the most recent correlation ids
 *   pnpm logs:trace 7f3a1c             replay every line whose id starts with 7f3a1c
 *   pnpm logs:trace --module auth      keep only what the auth module emitted
 *
 * It reads the combined file on purpose: the per-module files next to it
 * (api.auth.ndjson and friends) are for tailing one module, and a trace that
 * crosses modules only stays whole in the combined one.
 */

import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// pnpm --filter runs the API with its package directory as cwd, so the file
// lands under apps/api unless something started it from the root.
const CANDIDATES = [
	join(ROOT, 'logs', 'api.ndjson'),
	join(ROOT, 'apps', 'api', 'logs', 'api.ndjson'),
];

const LEVELS = new Map([
	[10, 'TRACE'],
	[20, 'DEBUG'],
	[30, 'INFO '],
	[40, 'WARN '],
	[50, 'ERROR'],
	[60, 'FATAL'],
]);

const NOISE = new Set([
	'level',
	'time',
	'msg',
	'pid',
	'hostname',
	'service',
	'env',
	'version',
	'correlationId',
	'locale',
	'module',
	'context',
]);

function logFile() {
	const found = CANDIDATES.find((candidate) => existsSync(candidate));
	if (found) return found;

	console.error('no NDJSON log found. Looked in:');
	for (const candidate of CANDIDATES) console.error(`  ${candidate}`);
	console.error('\nStart the API with LOG_TRANSPORT=pretty (the default in development).');
	process.exit(1);
}

async function* entries(file) {
	const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });

	for await (const line of lines) {
		if (!line.trim()) continue;
		try {
			yield JSON.parse(line);
		} catch {
			// A half-written final line is normal while the API is running.
		}
	}
}

function clock(entry) {
	return typeof entry.time === 'number' ? new Date(entry.time).toISOString().slice(11, 23) : '';
}

function origin(entry) {
	const parts = [entry.module, entry.context].filter(Boolean);
	return parts.length > 0 ? ` [${parts.join('/')}]` : '';
}

function extras(entry) {
	const rest = Object.entries(entry).filter(([key]) => !NOISE.has(key));
	return rest.length > 0 ? ` ${JSON.stringify(Object.fromEntries(rest))}` : '';
}

async function replay(file, prefix, module) {
	let matched = 0;

	for await (const entry of entries(file)) {
		if (typeof entry.correlationId !== 'string' || !entry.correlationId.startsWith(prefix))
			continue;
		if (module && entry.module !== module) continue;

		matched += 1;
		const level = LEVELS.get(entry.level) ?? String(entry.level ?? '');
		console.log(`${clock(entry)} ${level}${origin(entry)} ${entry.msg ?? ''}${extras(entry)}`);
	}

	if (matched === 0) {
		const scope = module ? ` from module "${module}"` : '';
		console.error(`no lines with a correlation id starting with "${prefix}"${scope} in ${file}`);
		process.exit(1);
	}
}

async function list(file, limit, module) {
	const seen = new Map();

	for await (const entry of entries(file)) {
		if (typeof entry.correlationId !== 'string') continue;

		const summary = seen.get(entry.correlationId) ?? {
			time: clock(entry),
			lines: 0,
			modules: new Set(),
		};
		if (entry.module) summary.modules.add(entry.module);
		summary.lines += 1;
		// customAttributeKeys renames req/res to request/response under pino-http,
		// but a line logged straight through the pino instance keeps req/res.
		const request = entry.request ?? entry.req;
		const response = entry.response ?? entry.res;

		// The auto-log lands last and carries the route, so let it win.
		if (request?.url) summary.route = `${request.method} ${request.url}`;
		if (response?.statusCode) summary.status = response.statusCode;
		if (entry.route) summary.route ??= entry.route;
		seen.set(entry.correlationId, summary);
	}

	const matching = [...seen.entries()].filter(
		([, summary]) => !module || summary.modules.has(module),
	);
	const recent = matching.slice(-limit);

	if (recent.length === 0) {
		const scope = module ? ` touching module "${module}"` : '';
		console.error(`${file} has no correlated lines${scope} yet`);
		process.exit(1);
	}

	for (const [id, summary] of recent) {
		const route = summary.route ?? '(no auto-log; 5xx are logged by the exception filter)';
		const status = summary.status ? ` ${summary.status}` : '';
		const lines = `${summary.lines} line${summary.lines === 1 ? '' : 's'}`;
		const modules = summary.modules.size > 0 ? `  ${[...summary.modules].join(',')}` : '';
		console.log(`${summary.time}  ${id}  ${lines}${modules}  ${route}${status}`);
	}

	console.log(`\nReplay one with: pnpm logs:trace ${recent.at(-1)[0].slice(0, 8)}`);
}

function parseArgs(argv) {
	const positional = [];
	let module;

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === '--module' || arg === '-m') {
			index += 1;
			module = argv[index];
		} else if (arg.startsWith('--module=')) {
			module = arg.slice('--module='.length);
		} else {
			positional.push(arg);
		}
	}

	return { prefix: positional[0], module };
}

const file = logFile();
const { prefix, module } = parseArgs(process.argv.slice(2));

await (prefix ? replay(file, prefix, module) : list(file, 20, module));
