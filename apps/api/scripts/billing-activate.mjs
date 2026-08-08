#!/usr/bin/env node
/**
 * Delivers a billing webhook to a running local API, the way the provider would.
 *
 * With BILLING_DRIVER=memory there is no provider to pay, so nothing ever tells
 * the app a subscription started and no local flow can reach `tier: "pro"`. This
 * signs an envelope with the same fake the API has mounted and POSTs it to
 * /billing/webhook over HTTP: the real route, the real signature check, the real
 * dedup and the real cache invalidation. Nothing here is a shortcut into the
 * service.
 *
 * For the flow with a real hosted checkout page, use Stripe test mode and
 * `stripe listen` instead - see docs/06-AMBIENTE-LOCAL.md.
 *
 * Usage:
 *   pnpm billing:activate activate --email ada@example.com
 *   pnpm billing:activate past-due --email ada@example.com
 *   pnpm billing:activate payment-failed --email ada@example.com
 *   pnpm billing:activate cancel --email ada@example.com
 *
 * The e-mail is the account's owner. With one account you may omit it.
 */

import { createDatabase } from '@vpn-poc/database';
import { loadWorkspaceDotenv } from '@vpn-poc/env';
import { FixedClock, MemoryBillingProvider } from '@vpn/testing/fakes';

loadWorkspaceDotenv();

const KINDS = {
	activate: { type: 'subscription_activated', status: 'active' },
	'past-due': { type: 'subscription_updated', status: 'past_due' },
	renew: { type: 'subscription_updated', status: 'active' },
	cancel: { type: 'subscription_canceled', status: 'canceled' },
	'payment-failed': { type: 'payment_failed', status: undefined },
};

function argOf(name) {
	const index = process.argv.indexOf(`--${name}`);
	return index === -1 ? undefined : process.argv[index + 1];
}

function die(message) {
	process.stderr.write(`\n${message}\n\n`);
	process.exit(1);
}

const command = process.argv[2] ?? 'activate';
const kind = KINDS[command];

if (!kind) {
	die(`unknown command "${command}"; try one of: ${Object.keys(KINDS).join(', ')}`);
}
if (process.env['BILLING_DRIVER'] === 'stripe') {
	die(
		'BILLING_DRIVER=stripe: a real provider sends its own webhooks.\n' +
			'Use `stripe listen --forward-to localhost:3000/billing/webhook` and pay with card 4242,\n' +
			'or `stripe trigger invoice.payment_failed`. See docs/06-AMBIENTE-LOCAL.md.',
	);
}

const apiUrl = argOf('api') ?? `http://127.0.0.1:${process.env['API_PORT'] ?? 3000}`;
const email = argOf('email');

const { sql } = createDatabase({
	url: process.env['DATABASE_URL'] ?? 'postgres://vpn_app:vpn_app_dev@127.0.0.1:25432/poc_vpn_dev',
	maxConnections: 1,
});

async function findAccount() {
	// The owner lookup crosses accounts, which is what app_system is for.
	return sql.begin(async (tx) => {
		await tx`set local role app_system`;

		return email
			? tx`select account_id, email from users where email = ${email} and role = 'owner'`
			: tx`select account_id, email from users where role = 'owner'`;
	});
}

const owners = await findAccount();

if (owners.length === 0) {
	await sql.end({ timeout: 5 });
	die(email ? `no account owned by ${email}` : 'no account found; register one first');
}
if (owners.length > 1) {
	const addresses = owners.map((row) => row.email).join('\n  ');
	await sql.end({ timeout: 5 });
	die(`more than one account; pass --email with one of:\n  ${addresses}`);
}

const accountId = String(owners[0].account_id);
const ownerEmail = String(owners[0].email);
await sql.end({ timeout: 5 });

const provider = new MemoryBillingProvider(new FixedClock(new Date()));
const externalId = `sub_${accountId}`;

const hook = provider.emit(kind.type, accountId, {
	...(kind.status
		? { subscription: provider.seedSubscription(externalId, accountId, kind.status) }
		: { externalCustomerId: `cus_${accountId}` }),
});

const response = await fetch(`${apiUrl}/billing/webhook`, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json', 'stripe-signature': hook.signature },
	body: hook.rawBody,
}).catch((error) => die(`cannot reach the API at ${apiUrl}: ${error.message}`));

const body = await response.text();

process.stdout.write(
	`\n${command} -> ${ownerEmail} (${accountId})\n` +
		`  POST ${apiUrl}/billing/webhook -> ${response.status} ${body}\n\n`,
);

if (!response.ok) {
	if (response.status === 403) {
		process.stdout.write(
			'A 403 here means the API has a different provider mounted than this script does.\n' +
				'It reads .env at boot, so restart it after changing BILLING_DRIVER.\n\n',
		);
	}
	process.exit(1);
}

if (command === 'activate') {
	process.stdout.write(
		'Refresh the app: the subscription reads Active and GET /entitlements answers tier "pro".\n' +
			'Cancel in the browser will fail under BILLING_DRIVER=memory - the fake the API mounted\n' +
			'never created this subscription, and a provider asked to cancel an id it does not know\n' +
			'is right to refuse. Use `pnpm billing:activate cancel` instead.\n\n',
	);
}
