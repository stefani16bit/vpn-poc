process.env['NODE_ENV'] = 'test';
process.env['LOG_LEVEL'] ??= 'silent';
process.env['WEB_ORIGIN'] = 'http://127.0.0.1:5173';
process.env['DATABASE_URL'] ??= 'postgres://vpn_app:vpn_app_dev@127.0.0.1:25432/poc_vpn_dev';
process.env['AUTH_JWT_SECRET'] = 'e2e-secret-e2e-secret-e2e-secret-0000';
process.env['AUTH_ACCESS_TOKEN_TTL'] = '900';

process.env['CACHE_DRIVER'] = 'memory';
process.env['EMAIL_DRIVER'] = 'smtp';
process.env['SMTP_HOST'] = '127.0.0.1';
process.env['SMTP_PORT'] = '21025';
process.env['SMS_DRIVER'] = 'memory';
process.env['BILLING_DRIVER'] = 'memory';
process.env['STORAGE_DRIVER'] = 'memory';
process.env['QUEUE_DRIVER'] = 'memory';
process.env['STRIPE_PRICE_ID'] = 'price_local_monthly';
process.env['STRIPE_PRICE_ID_YEARLY'] = 'price_local_yearly';
process.env['SENTRY_DSN'] = '';

export const MAILPIT_URL = 'http://127.0.0.1:28025';
