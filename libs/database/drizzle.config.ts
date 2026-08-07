import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

for (const path of ['../../.env.local', '../../.env']) {
	loadDotenv({ path, override: false });
}

export default defineConfig({
	schema: './src/schema.ts',
	out: './migrations',
	dialect: 'postgresql',
	dbCredentials: {
		url:
			process.env.DATABASE_MIGRATION_URL ??
			'postgres://vpn_migrator:vpn_migrator_dev@127.0.0.1:25432/poc_vpn_dev',
	},
	strict: true,
	verbose: true,
});
