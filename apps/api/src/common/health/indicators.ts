import { sql } from 'drizzle-orm';

import type { ICacheStore } from '@vpn/ports';

import type { HealthIndicator } from './health.types.js';

export interface QueryableDatabase {
	execute(query: ReturnType<typeof sql>): PromiseLike<unknown>;
}

export function databaseIndicator(db: QueryableDatabase): HealthIndicator {
	return {
		name: 'database',
		check: async () => {
			await db.execute(sql`SELECT 1`);
		},
	};
}

export function cacheIndicator(cache: ICacheStore): HealthIndicator {
	return {
		name: 'cache',
		check: async () => {
			const key = { owner: null, namespace: 'health', id: 'probe' } as const;
			await cache.set(key, 1, 10);
			await cache.get(key);
		},
	};
}
