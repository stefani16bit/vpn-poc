import { afterEach, describe, expect, it, vi } from 'vitest';

import { fromBase64Url, generateKeyPair, toBase64 } from './keypair.js';

const WIREGUARD_PUBLIC_KEY = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/;

afterEach(() => {
	vi.unstubAllGlobals();
});

// A browser without X25519 still has getRandomValues, and it lives on the
// prototype: spreading crypto drops it and noble then fails for the wrong reason.
function withoutSubtleX25519() {
	const real = globalThis.crypto;

	vi.stubGlobal('crypto', {
		getRandomValues: real.getRandomValues.bind(real),
		randomUUID: real.randomUUID.bind(real),
		subtle: {
			...real.subtle,
			generateKey: () =>
				Promise.reject(new DOMException('Unrecognized name.', 'NotSupportedError')),
		},
	});
}

describe('generateKeyPair', () => {
	it('produces a public key wireguard would accept', async () => {
		const pair = await generateKeyPair();
		expect(pair.publicKey).toMatch(WIREGUARD_PUBLIC_KEY);
	});

	it('produces a 32 byte private key, which is what the .conf carries', async () => {
		const pair = await generateKeyPair();
		expect(atob(pair.privateKey)).toHaveLength(32);
	});

	it('never returns the same pair twice', async () => {
		const [first, second] = await Promise.all([generateKeyPair(), generateKeyPair()]);
		expect(first.privateKey).not.toBe(second.privateKey);
	});

	it('uses crypto.subtle when the browser implements X25519', async () => {
		expect((await generateKeyPair()).source).toBe('webcrypto');
	});

	it('falls back to noble when generateKey rejects the algorithm', async () => {
		withoutSubtleX25519();

		const pair = await generateKeyPair();

		expect(pair.source).toBe('noble');
		expect(pair.publicKey).toMatch(WIREGUARD_PUBLIC_KEY);
		expect(atob(pair.privateKey)).toHaveLength(32);
	});

	it('derives the same public key from both paths, so the fallback is interchangeable', async () => {
		const viaSubtle = await generateKeyPair();
		expect(viaSubtle.source).toBe('webcrypto');

		const { x25519 } = await import('@noble/curves/ed25519.js');
		const privateKey = Uint8Array.from(atob(viaSubtle.privateKey), (c) => c.charCodeAt(0));

		expect(toBase64(x25519.getPublicKey(privateKey))).toBe(viaSubtle.publicKey);
	});
});

describe('base64 helpers', () => {
	it('round-trips every byte value, because a key is arbitrary bytes', () => {
		const bytes = Uint8Array.from({ length: 256 }, (_unused, index) => index);
		expect(atob(toBase64(bytes))).toHaveLength(256);
	});

	it('reads the base64url a JWK scalar arrives in', () => {
		expect(fromBase64Url('-_8')).toEqual(Uint8Array.from([251, 255]));
	});
});
