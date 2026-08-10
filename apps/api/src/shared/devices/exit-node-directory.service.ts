import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';

import {
	CLOCK,
	EXIT_NODE,
	type ExitNodeDescription,
	type IClock,
	type IExitNode,
} from '@vpn/ports';

const TTL_SECONDS = 60;

@Injectable()
export class ExitNodeDirectory implements OnApplicationBootstrap {
	readonly #logger = new Logger(ExitNodeDirectory.name);
	#description: Promise<ExitNodeDescription> | null = null;
	#readAt: Date | null = null;
	#publicKey: string | null = null;

	constructor(
		@Inject(EXIT_NODE) private readonly node: IExitNode,
		@Inject(CLOCK) private readonly clock: IClock,
	) {}

	onApplicationBootstrap(): void {
		void this.current().catch(() => {
			this.#description = null;
		});
	}

	current(): Promise<ExitNodeDescription> {
		if (this.#stale()) this.#description = null;
		this.#description ??= this.#read();

		return this.#description;
	}

	#stale(): boolean {
		if (!this.#readAt) return false;

		return this.clock.now().getTime() - this.#readAt.getTime() >= TTL_SECONDS * 1000;
	}

	#read(): Promise<ExitNodeDescription> {
		return this.node.describe().then(
			(description) => {
				this.#readAt = this.clock.now();
				this.#reportRotation(description.publicKey);
				this.#publicKey = description.publicKey;

				return description;
			},
			(error: unknown) => {
				this.#description = null;
				this.#readAt = null;

				throw error;
			},
		);
	}

	#reportRotation(publicKey: string): void {
		if (!this.#publicKey || this.#publicKey === publicKey) return;

		this.#logger.error(
			{ event: 'exit_node.public_key_changed', was: this.#publicKey, now: publicKey },
			'the exit node reports a different public key: every .conf already downloaded is dead',
		);
	}
}
