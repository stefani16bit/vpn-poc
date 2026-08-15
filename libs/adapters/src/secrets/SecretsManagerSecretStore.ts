import {
	GetSecretValueCommand,
	ResourceNotFoundException,
	SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

import type { ISecretStore, SecretVersions } from '@vpn/ports';

// The two staging labels Secrets Manager maintains on its own: a write moves
// AWSCURRENT to the new version and AWSPREVIOUS to the one it displaced, and
// the version before that keeps no label at all.
const CURRENT = 'AWSCURRENT';
const PREVIOUS = 'AWSPREVIOUS';

export interface SecretsManagerSecretStoreOptions {
	readonly region: string;
	readonly endpoint?: string | undefined;
}

export class SecretsManagerSecretStore implements ISecretStore {
	readonly #client: SecretsManagerClient;

	constructor(options: SecretsManagerSecretStoreOptions) {
		this.#client = new SecretsManagerClient({
			region: options.region,
			...(options.endpoint ? { endpoint: options.endpoint } : {}),
		});
	}

	async read(ref: string): Promise<SecretVersions | null> {
		const current = await this.#at(ref, CURRENT);
		if (current === null) return null;

		return { current, previous: await this.#at(ref, PREVIOUS) };
	}

	// The same ResourceNotFoundException answers both "no such secret" and "no
	// such staging label on it", so the caller decides what the absence means:
	// no current is a ref nobody created, no previous is a ref nobody rotated.
	// Reading it the other way makes every un-rotated secret look missing.
	async #at(ref: string, stage: string): Promise<string | null> {
		try {
			const response = await this.#client.send(
				new GetSecretValueCommand({ SecretId: ref, VersionStage: stage }),
			);

			// A secret written as binary is one nobody here put there, and handing
			// back a decoded guess would produce a credential that fails far away.
			return response.SecretString ?? null;
		} catch (error: unknown) {
			if (error instanceof ResourceNotFoundException) return null;

			throw error;
		}
	}
}
