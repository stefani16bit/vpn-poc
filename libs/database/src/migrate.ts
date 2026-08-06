import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/postgres-js/migrator';

import { createDatabase } from './client.js';

const url = process.env['DATABASE_MIGRATION_URL'];
if (!url) {
	console.error('DATABASE_MIGRATION_URL is required to run migrations');
	process.exit(1);
}

const { db, sql } = createDatabase({ url, maxConnections: 1 });

try {
	await migrate(db, {
		migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations'),
	});
	console.log('migrations applied');
} finally {
	await sql.end();
}
