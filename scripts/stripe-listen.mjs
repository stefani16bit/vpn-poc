#!/usr/bin/env node
/**
 * Forwards Stripe webhooks to the local API, from the account STRIPE_API_KEY
 * names.
 *
 * Bare `stripe listen` uses whichever account `stripe login` last wrote to the
 * CLI config, which is not necessarily the one the app charges against - a
 * sandbox and its parent are two accounts, and the CLI defaults to neither in
 * particular. A listener on the wrong account registers its endpoint there, so
 * events fire on the right one with nowhere to go: nothing is forwarded, and
 * neither the CLI nor the API logs anything at all. Passing the key the app
 * itself uses is what keeps the two on one account.
 *
 * Usage:
 *   pnpm dev:stripe
 *   pnpm dev:stripe --key sk_test_...     use this key instead of the .env one
 *
 * Anything else on the command line is handed to `stripe listen` untouched.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_PORT = '3000';
const WEBHOOK_PATH = '/billing/webhook';

function argOf(name) {
	const index = process.argv.indexOf(`--${name}`);
	return index === -1 ? undefined : process.argv[index + 1];
}

function passthroughArgs() {
	const args = process.argv.slice(2);
	const index = args.indexOf('--key');
	if (index === -1) return args;
	return [...args.slice(0, index), ...args.slice(index + 2)];
}

// Same two files loadEnv reads, in the same order, so the listener and the API
// cannot disagree about which account this checkout belongs to.
function fromDotenv(name) {
	for (const file of ['.env.local', '.env']) {
		const path = join(ROOT, file);
		if (!existsSync(path)) continue;

		const match = new RegExp(`^${name}=(.*)$`, 'm').exec(readFileSync(path, 'utf8'));
		const value = match?.[1]
			?.trim()
			.replace(/\s+#.*$/, '')
			.replace(/^["']|["']$/g, '');
		if (value) return value;
	}

	return undefined;
}

const key = argOf('key') ?? process.env['STRIPE_API_KEY'] ?? fromDotenv('STRIPE_API_KEY');

if (!key) {
	console.error('no STRIPE_API_KEY in .env.local, .env or the environment, and no --key given.');
	console.error('The listener needs it to watch the same account the app charges against.');
	process.exit(1);
}

// 127.0.0.1 and not localhost: the CLI tries ::1 first, and the API binds IPv4
// only, so `localhost` forwards into whatever else on this machine took the
// dual-stack socket - reported as a 404 on every event. DEC-032.
const port = process.env['API_PORT'] ?? fromDotenv('API_PORT') ?? DEFAULT_PORT;
const target = `127.0.0.1:${port}${WEBHOOK_PATH}`;

const child = spawn(
	'stripe',
	['listen', '--api-key', key, '--forward-to', target, ...passthroughArgs()],
	{ stdio: 'inherit', shell: process.platform === 'win32' },
);

child.on('error', (error) => {
	if (error.code === 'ENOENT') {
		console.error('the stripe CLI is not on PATH: https://docs.stripe.com/stripe-cli');
		process.exit(1);
	}

	throw error;
});

child.on('exit', (code, signal) => {
	process.exit(signal ? 1 : (code ?? 0));
});
