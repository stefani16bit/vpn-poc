import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import type { IPasswordHasher } from '@vpn/ports';

const scryptAsync = promisify(scrypt) as (
	password: string,
	salt: Buffer,
	keylen: number,
	options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

export interface ScryptParams {
	readonly N: number;
	readonly r: number;
	readonly p: number;
}

const CURRENT: ScryptParams = { N: 2 ** 17, r: 8, p: 1 };

const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

export class ScryptPasswordHasher implements IPasswordHasher {
	readonly #params: ScryptParams;

	constructor(params: ScryptParams = CURRENT) {
		this.#params = params;
	}

	async hash(plaintext: string): Promise<string> {
		const salt = randomBytes(SALT_LENGTH);
		const derived = await this.#derive(plaintext, salt, this.#params);
		const { N, r, p } = this.#params;
		return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${derived.toString('base64')}`;
	}

	async verify(plaintext: string, hash: string): Promise<boolean> {
		const parsed = parseHash(hash);
		if (!parsed) return false;

		let derived: Buffer;
		try {
			derived = await this.#derive(plaintext, parsed.salt, parsed.params);
		} catch {
			return false;
		}

		if (derived.length !== parsed.hash.length) return false;
		return timingSafeEqual(derived, parsed.hash);
	}

	needsRehash(hash: string): boolean {
		const parsed = parseHash(hash);
		if (!parsed) return true;
		return (
			parsed.params.N < this.#params.N ||
			parsed.params.r < this.#params.r ||
			parsed.params.p < this.#params.p
		);
	}

	#derive(plaintext: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
		return scryptAsync(plaintext, salt, KEY_LENGTH, {
			...params,
			maxmem: 128 * params.N * params.r * 2,
		});
	}
}

interface ParsedHash {
	readonly params: ScryptParams;
	readonly salt: Buffer;
	readonly hash: Buffer;
}

function parseHash(value: string): ParsedHash | null {
	const parts = value.split('$');
	if (parts.length !== 6 || parts[0] !== 'scrypt') return null;

	const N = Number(parts[1]);
	const r = Number(parts[2]);
	const p = Number(parts[3]);
	if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
	if (N <= 1 || r <= 0 || p <= 0) return null;

	try {
		const salt = Buffer.from(parts[4] ?? '', 'base64');
		const hash = Buffer.from(parts[5] ?? '', 'base64');
		if (salt.length === 0 || hash.length === 0) return null;
		return { params: { N, r, p }, salt, hash };
	} catch {
		return null;
	}
}
