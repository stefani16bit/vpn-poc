import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';

import { EXIT_NODE, type ExitNodeDescription, type IExitNode } from '@vpn/ports';

@Injectable()
export class ExitNodeDirectory implements OnApplicationBootstrap {
	#description: Promise<ExitNodeDescription> | null = null;

	constructor(@Inject(EXIT_NODE) private readonly node: IExitNode) {}

	onApplicationBootstrap(): void {
		void this.current().catch(() => {
			this.#description = null;
		});
	}

	current(): Promise<ExitNodeDescription> {
		this.#description ??= this.node.describe().catch((error: unknown) => {
			this.#description = null;
			throw error;
		});

		return this.#description;
	}
}
