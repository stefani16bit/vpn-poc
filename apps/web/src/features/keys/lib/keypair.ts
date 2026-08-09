export interface KeyPair {
	readonly publicKey: string;
	readonly privateKey: string;
}

export type KeySource = 'webcrypto' | 'noble';

export interface GeneratedKeyPair extends KeyPair {
	readonly source: KeySource;
}

export function toBase64(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

export function fromBase64Url(value: string): Uint8Array {
	const padded = value.replace(/-/g, '+').replace(/_/g, '/');
	const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function viaWebCrypto(): Promise<KeyPair> {
	const pair = (await crypto.subtle.generateKey({ name: 'X25519' }, true, [
		'deriveBits',
	])) as CryptoKeyPair;

	const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
	const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);

	if (!jwk.d) throw new Error('X25519 private key came back without a scalar');

	return { publicKey: toBase64(publicKey), privateKey: toBase64(fromBase64Url(jwk.d)) };
}

async function viaNoble(): Promise<KeyPair> {
	const { x25519 } = await import('@noble/curves/ed25519.js');
	const privateKey = x25519.utils.randomSecretKey();

	return {
		publicKey: toBase64(x25519.getPublicKey(privateKey)),
		privateKey: toBase64(privateKey),
	};
}

export async function generateKeyPair(): Promise<GeneratedKeyPair> {
	try {
		return { ...(await viaWebCrypto()), source: 'webcrypto' };
	} catch {
		return { ...(await viaNoble()), source: 'noble' };
	}
}
