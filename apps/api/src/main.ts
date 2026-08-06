/* v8 ignore start -- process bootstrap; covered by the e2e suite through createApp */

import 'reflect-metadata';

import { loadEnv } from '@vpn-poc/env';

import { createApp } from './bootstrap.js';

const env = loadEnv();
const app = await createApp();

await app.listen(env.API_PORT, '0.0.0.0');

/* v8 ignore stop */
