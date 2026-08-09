export const INTEGRATION = {
	redisUrl: process.env['REDIS_URL'] ?? 'redis://127.0.0.1:26379',
	databaseUrl:
		process.env['DATABASE_URL'] ?? 'postgres://vpn_app:vpn_app_dev@127.0.0.1:25432/poc_vpn_dev',
	smtpHost: process.env['SMTP_HOST'] ?? '127.0.0.1',
	smtpPort: Number(process.env['SMTP_PORT'] ?? 21025),
	mailpitUrl: process.env['MAILPIT_URL'] ?? 'http://127.0.0.1:28025',
	s3Endpoint: process.env['AWS_ENDPOINT_URL'] ?? 'http://127.0.0.1:24566',
	sqsEndpoint: process.env['AWS_ENDPOINT_URL'] ?? 'http://127.0.0.1:24566',
	s3Bucket: process.env['S3_BUCKET'] ?? 'poc-vpn-assets',
	awsRegion: process.env['AWS_REGION'] ?? 'us-east-1',
	stripeApiBase: process.env['STRIPE_API_BASE'] ?? 'http://127.0.0.1:28420',
	stripeApiKey: process.env['STRIPE_API_KEY'] ?? 'sk_test_local',
	stripeWebhookSecret: process.env['STRIPE_WEBHOOK_SECRET'] ?? 'whsec_local',
	exitNodeApiUrl: process.env['EXIT_NODE_API_URL'] ?? 'http://127.0.0.1:21821',
	exitNodeEndpoint: process.env['EXIT_NODE_ENDPOINT'] ?? '127.0.0.1:21820',
	exitNodeTunnelCidr: process.env['EXIT_NODE_TUNNEL_CIDR'] ?? '10.13.13.0/24',
} as const;

process.env['AWS_ACCESS_KEY_ID'] ??= 'test';
process.env['AWS_SECRET_ACCESS_KEY'] ??= 'test';
