import { destination } from 'pino';
import { prettyFactory } from 'pino-pretty';
import type { PrettyOptions } from 'pino-pretty';

import { AMBIENT_MODULE, type ApiModule, isApiModule } from './api-module.js';

export interface ModuleFanoutOptions {
	readonly combined: string;
	readonly pretty?: PrettyOptions;
	readonly out?: (line: string) => void;
}

export interface ModuleFanout {
	write(line: string): void;
}

export function moduleLogFile(combined: string, module: ApiModule): string {
	return combined.replace(/\.ndjson$/, `.${module}.ndjson`);
}

function moduleOf(line: string): ApiModule {
	try {
		const parsed: unknown = JSON.parse(line);
		if (typeof parsed !== 'object' || parsed === null) return AMBIENT_MODULE;

		const candidate = (parsed as Record<string, unknown>).module;
		return isApiModule(candidate) ? candidate : AMBIENT_MODULE;
	} catch {
		return AMBIENT_MODULE;
	}
}

export function createModuleFanout(options: ModuleFanoutOptions): ModuleFanout {
	// sync destinations: dev-only volume, and it removes every flush-on-shutdown concern.
	const open = (path: string): { write: (line: string) => void } =>
		destination({ dest: path, mkdir: true, append: false, sync: true });

	const destinations = new Map<string, { write: (line: string) => void }>();
	const format = options.pretty === undefined ? undefined : prettyFactory(options.pretty);
	const out = options.out ?? ((line: string) => process.stdout.write(line));

	const destinationFor = (path: string): { write: (line: string) => void } => {
		let destination = destinations.get(path);
		if (destination === undefined) {
			destination = open(path);
			destinations.set(path, destination);
		}
		return destination;
	};

	return {
		write(line: string): void {
			destinationFor(options.combined).write(line);
			destinationFor(moduleLogFile(options.combined, moduleOf(line))).write(line);

			if (format !== undefined) out(format(line));
		},
	};
}
