export type EnvironmentName = 'dev' | 'prod';

export interface EnvironmentConfig {
	readonly name: EnvironmentName;
	readonly account: string | undefined;
	readonly region: string;

	readonly natGateways: number;
	readonly databaseMultiAz: boolean;
	readonly apiConcurrency: number;
	readonly logRetentionDays: number;
	readonly protectResources: boolean;
}

const dev: EnvironmentConfig = {
	name: 'dev',
	account: process.env['CDK_DEFAULT_ACCOUNT'],
	region: 'us-east-1',
	natGateways: 1,
	databaseMultiAz: false,
	apiConcurrency: 10,
	logRetentionDays: 7,
	protectResources: false,
};

const prod: EnvironmentConfig = {
	name: 'prod',
	account: process.env['CDK_DEFAULT_ACCOUNT'],
	region: 'us-east-1',
	natGateways: 2,
	databaseMultiAz: true,
	apiConcurrency: 100,
	logRetentionDays: 90,
	protectResources: true,
};

const ENVIRONMENTS: Record<EnvironmentName, EnvironmentConfig> = { dev, prod };

export function environmentFor(name: string | undefined): EnvironmentConfig {
	const resolved = name ?? 'dev';
	if (!isEnvironmentName(resolved)) {
		throw new Error(`unknown environment "${resolved}"; expected one of: dev, prod`);
	}
	return validate(ENVIRONMENTS[resolved]);
}

function isEnvironmentName(value: string): value is EnvironmentName {
	return value === 'dev' || value === 'prod';
}

export function validate(config: EnvironmentConfig): EnvironmentConfig {
	const problems: string[] = [];

	if (config.natGateways < 1) problems.push('natGateways must be at least 1');
	if (config.name === 'prod' && config.natGateways < 2) {
		problems.push('prod needs a NAT gateway per AZ to survive a zonal outage');
	}
	if (config.name === 'prod' && !config.databaseMultiAz) {
		problems.push('prod needs a multi-AZ database');
	}
	if (config.name === 'prod' && !config.protectResources) {
		problems.push('prod must not allow the database to be destroyed by a stack update');
	}
	if (config.apiConcurrency > 200) {
		problems.push('apiConcurrency above 200 needs an RDS Proxy connection review first');
	}
	if (config.logRetentionDays < 7) problems.push('log retention below 7 days is not investigable');

	if (problems.length > 0) {
		throw new Error(`invalid configuration for "${config.name}":\n  - ${problems.join('\n  - ')}`);
	}

	return config;
}
