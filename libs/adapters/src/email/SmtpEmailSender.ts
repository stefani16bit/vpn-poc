import type { Transporter } from 'nodemailer';

import type { EmailMessage, ICacheStore, IEmailSender } from '@vpn/ports';

import { renderEmail } from './render.js';

const IDEMPOTENCY_NAMESPACE = 'email-idempotency';
const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

export interface SmtpEmailSenderOptions {
	readonly from: string;
}

export class SmtpEmailSender implements IEmailSender {
	readonly #transport: Transporter;
	readonly #cache: ICacheStore;
	readonly #from: string;

	constructor(transport: Transporter, cache: ICacheStore, options: SmtpEmailSenderOptions) {
		this.#transport = transport;
		this.#cache = cache;
		this.#from = options.from;
	}

	async send(message: EmailMessage): Promise<void> {
		const key = {
			owner: null,
			namespace: IDEMPOTENCY_NAMESPACE,
			id: message.idempotencyKey,
		} as const;

		if ((await this.#cache.get<boolean>(key)) === true) return;
		await this.#cache.set(key, true, IDEMPOTENCY_TTL_SECONDS);

		const rendered = renderEmail(message.template, message.locale, message.variables);

		try {
			await this.#transport.sendMail({
				from: this.#from,
				to: message.to,
				subject: rendered.subject,
				text: rendered.text,
				headers: {
					'X-Idempotency-Key': message.idempotencyKey,
				},
			});
		} catch (error) {
			await this.#cache.delete(key);
			throw error;
		}
	}
}
