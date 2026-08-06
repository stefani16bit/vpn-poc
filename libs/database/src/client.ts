import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema.js';

export type Database = ReturnType<typeof createDatabase>['db'];

export interface CreateDatabaseOptions {
	readonly url: string;
	readonly maxConnections?: number;
}

export function createDatabase(options: CreateDatabaseOptions) {
	const sql = postgres(options.url, {
		max: options.maxConnections ?? 10,
		prepare: false,
		onnotice: () => {},
	});

	return { db: drizzle(sql, { schema }), sql };
}

export { schema };
