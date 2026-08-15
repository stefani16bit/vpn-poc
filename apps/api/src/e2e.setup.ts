process.env['NODE_ENV'] = 'test';
process.env['LOG_LEVEL'] ??= 'silent';
process.env['WEB_ORIGIN'] = 'http://127.0.0.1:5173';
process.env['DATABASE_URL'] ??= 'postgres://vpn_app:vpn_app_dev@127.0.0.1:25432/poc_vpn_dev';
process.env['AUTH_ACCESS_TOKEN_TTL'] = '900';

process.env['CACHE_DRIVER'] = 'memory';
process.env['EMAIL_DRIVER'] = 'smtp';
process.env['SMTP_HOST'] = '127.0.0.1';
process.env['SMTP_PORT'] = '21025';
process.env['SMS_DRIVER'] = 'memory';
process.env['BILLING_DRIVER'] = 'memory';
process.env['STORAGE_DRIVER'] = 'memory';
process.env['QUEUE_DRIVER'] = 'memory';
// The one driver that is not memory, and it is not an oversight: the signing
// secret is read through the store now, so faking the store would leave the e2e
// proving a path production does not take. It reaches the same localstack the
// devstack already runs, and reads the ref 01-resources.sh seeded. DEC-101.
process.env['SECRETS_DRIVER'] = 'aws';
process.env['AWS_ENDPOINT_URL'] ??= 'http://127.0.0.1:24566';
process.env['AWS_REGION'] ??= 'us-east-1';
process.env['AWS_ACCESS_KEY_ID'] ??= 'test';
process.env['AWS_SECRET_ACCESS_KEY'] ??= 'test';
process.env['EXIT_NODE_DRIVER'] = 'memory';
process.env['STRIPE_PRICE_ID'] = 'price_local_monthly';
process.env['STRIPE_PRICE_ID_YEARLY'] = 'price_local_yearly';
process.env['SENTRY_DSN'] = '';

export const MAILPIT_URL = 'http://127.0.0.1:28025';
