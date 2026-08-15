import { describe, expect, it, vi } from 'vitest';

import { FixedClock, MemorySecretStore } from '@vpn/testing/fakes';

import { CachingSecretStore } from './CachingSecretStore.js';

const SP = 'poc-vpn/exit-node/sp';
const FRA = 'poc-vpn/exit-node/fra';

function storeOn(seed: Record<string, string> = { [SP]: 'the-sp-one', [FRA]: 'the-fra-one' }) {
	const inner = new MemorySecretStore(seed);
	const clock = new FixedClock();

	return { store: new CachingSecretStore({ inner, clock }), inner, clock };
}

describe('CachingSecretStore', () => {
	it('reads a ref once inside the window, so a sweep is not a call per node', async () => {
		const { store, inner } = storeOn();
		const read = vi.spyOn(inner, 'read');

		await store.read(SP);
		await store.read(SP);

		expect(read).toHaveBeenCalledTimes(1);
	});

	it('reads again once the window closes, which is how a rotation lands', async () => {
		const { store, inner, clock } = storeOn();
		await store.read(SP);
		inner.seed(SP, 'the-rotated-one');

		clock.advance(301);

		await expect(store.read(SP)).resolves.toEqual({
			current: 'the-rotated-one',
			previous: 'the-sp-one',
		});
	});

	it('serves the stale value until the window closes, which is the trade being made', async () => {
		const { store, inner } = storeOn();
		await store.read(SP);
		inner.seed(SP, 'the-rotated-one');

		await expect(store.read(SP)).resolves.toEqual({ current: 'the-sp-one', previous: null });
	});

	// Caching the absence would make "create the secret" take five minutes to
	// take effect, which is exactly when the operator is watching.
	it('never caches a ref that resolved to nothing', async () => {
		const { store, inner } = storeOn({});
		const read = vi.spyOn(inner, 'read');

		await expect(store.read(SP)).resolves.toBeNull();
		await expect(store.read(SP)).resolves.toBeNull();

		expect(read).toHaveBeenCalledTimes(2);
	});

	// The other half of "absence is never cached": a ref that was cached and then
	// vanished still answers until the window closes, and then answers null
	// rather than re-reading forever off a stale entry.
	it('serves a vanished ref until the window closes, then reports it gone', async () => {
		const { store, inner, clock } = storeOn();
		await store.read(SP);
		inner.forget(SP);

		await expect(store.read(SP)).resolves.toEqual({ current: 'the-sp-one', previous: null });

		clock.advance(301);

		await expect(store.read(SP)).resolves.toBeNull();
	});

	it('keeps two refs apart, or one node would answer with another credential', async () => {
		const { store, inner } = storeOn();
		const read = vi.spyOn(inner, 'read');

		await store.read(SP);
		await store.read(FRA);
		await store.read(SP);

		expect(read).toHaveBeenCalledTimes(2);
		await expect(store.read(FRA)).resolves.toEqual({ current: 'the-fra-one', previous: null });
	});

	it('carries both halves of the window through the cache, not just the current one', async () => {
		const { store, inner } = storeOn({});
		inner.seed(SP, 'first');
		inner.seed(SP, 'second');

		await store.read(SP);

		await expect(store.read(SP)).resolves.toEqual({ current: 'second', previous: 'first' });
	});
});
