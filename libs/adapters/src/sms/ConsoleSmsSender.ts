import type { ICacheStore, ISmsSender, SmsMessage } from '@vpn/ports';

import { renderSms } from '../email/render.js';

const E164 = /^\+[1-9]\d{7,14}$/;
const IDEMPOTENCY_NAMESPACE = 'sms-idempotency';
const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

export interface ConsoleSmsSenderOptions {
	readonly nodeEnv: string;
	readonly log: (message: string) => void;
}

export class ConsoleSmsSender implements ISmsSender {
	readonly #cache: ICacheStore;
	readonly #log: (message: string) => void;

	constructor(cache: ICacheStore, options: ConsoleSmsSenderOptions) {
		if (options.nodeEnv === 'production') {
			throw new Error(
				'ConsoleSmsSender must not run in production: it prints codes instead of sending them',
			);
		}
		this.#cache = cache;
		this.#log = options.log;
	}

	async send(message: SmsMessage): Promise<void> {
		if (!E164.test(message.phoneNumber)) {
			throw new Error(`phoneNumber must be E.164, got: ${message.phoneNumber}`);
		}

		const key = {
			owner: null,
			namespace: IDEMPOTENCY_NAMESPACE,
			id: message.idempotencyKey,
		} as const;

		if ((await this.#cache.get<boolean>(key)) === true) return;
		await this.#cache.set(key, true, IDEMPOTENCY_TTL_SECONDS);

		const text = renderSms(message.template, message.locale, message.variables);

		this.#log(`[sms:${message.template}] to=${message.phoneNumber} ${text}`);
	}
}
