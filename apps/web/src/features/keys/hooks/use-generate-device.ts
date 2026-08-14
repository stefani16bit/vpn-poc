import type { SerializedError } from '@reduxjs/toolkit';
import type { FetchBaseQueryError } from '@reduxjs/toolkit/query';
import { useState } from 'react';

import { downloadTextFile } from '@/lib/download.js';
import { useCreateDeviceMutation } from '@/features/keys/api/keys.api.js';
import { generateKeyPair } from '@/features/keys/lib/keypair.js';
import { buildWireguardConfig, configFileName } from '@/features/keys/lib/wireguard-config.js';

export interface GenerateDevice {
	readonly generate: (name: string, regionId: string, userId?: string) => Promise<void>;
	readonly pending: boolean;
	readonly downloaded: string | null;
	readonly unsupported: boolean;
	readonly error: FetchBaseQueryError | SerializedError | undefined;
}

export function useGenerateDevice(): GenerateDevice {
	const [createDevice, state] = useCreateDeviceMutation();
	const [downloaded, setDownloaded] = useState<string | null>(null);
	const [unsupported, setUnsupported] = useState(false);
	const [generating, setGenerating] = useState(false);

	async function generate(name: string, regionId: string, userId?: string): Promise<void> {
		setGenerating(true);
		setUnsupported(false);

		try {
			const pair = await generateKeyPair().catch(() => null);
			if (!pair) {
				setUnsupported(true);
				return;
			}

			const result = await createDevice({
				name,
				regionId,
				publicKey: pair.publicKey,
				...(userId ? { userId } : {}),
			});
			if (!('data' in result) || !result.data) return;

			downloadTextFile(
				configFileName(result.data.device.name),
				buildWireguardConfig({
					device: result.data.device,
					node: result.data.device.node,
					privateKey: pair.privateKey,
				}),
			);

			setDownloaded(result.data.device.id);
		} finally {
			setGenerating(false);
		}
	}

	return {
		generate,
		pending: generating || state.isLoading,
		downloaded,
		unsupported,
		error: state.error,
	};
}
