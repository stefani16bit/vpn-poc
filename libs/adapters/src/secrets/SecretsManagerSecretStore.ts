import {
	GetSecretValueCommand,
	ResourceNotFoundException,
	SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

import type { ISecretStore } from '@vpn/ports';

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

	async read(ref: string): Promise<string | null> {
		try {
			const response = await this.#client.send(new GetSecretValueCommand({ SecretId: ref }));

			// A secret written as binary is one nobody here put there, and handing
			// back a decoded guess would produce a credential that fails far away.
			return response.SecretString ?? null;
		} catch (error: unknown) {
			if (error instanceof ResourceNotFoundException) return null;

			throw error;
		}
	}
}
