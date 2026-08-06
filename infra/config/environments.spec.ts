import { describe, expect, it } from 'vitest';

import { environmentFor, validate, type EnvironmentConfig } from './environments.js';

describe('environmentFor', () => {
	it('defaults to dev', () => {
		expect(environmentFor(undefined).name).toBe('dev');
	});

	it('rejects an unknown environment by name', () => {
		expect(() => environmentFor('staging')).toThrow(/unknown environment/);
	});

	it('keeps dev cheap', () => {
		const config = environmentFor('dev');
		expect(config.natGateways).toBe(1);
		expect(config.databaseMultiAz).toBe(false);
	});

	it('keeps prod survivable', () => {
		const config = environmentFor('prod');
		expect(config.natGateways).toBeGreaterThanOrEqual(2);
		expect(config.databaseMultiAz).toBe(true);
		expect(config.protectResources).toBe(true);
	});
});

describe('validate', () => {
	const prod: EnvironmentConfig = {
		name: 'prod',
		account: '000000000000',
		region: 'us-east-1',
		natGateways: 2,
		databaseMultiAz: true,
		apiConcurrency: 100,
		logRetentionDays: 90,
		protectResources: true,
	};

	it('accepts a well-formed production configuration', () => {
		expect(() => validate(prod)).not.toThrow();
	});

	it('refuses a single-AZ production database', () => {
		expect(() => validate({ ...prod, databaseMultiAz: false })).toThrow(/multi-AZ/);
	});

	it('refuses a single NAT gateway in production', () => {
		expect(() => validate({ ...prod, natGateways: 1 })).toThrow(/zonal outage/);
	});

	it('refuses a destroyable production database', () => {
		expect(() => validate({ ...prod, protectResources: false })).toThrow(/destroyed/);
	});

	it('refuses concurrency that would exhaust the connection pool unreviewed', () => {
		expect(() => validate({ ...prod, apiConcurrency: 500 })).toThrow(/RDS Proxy/);
	});

	it('refuses log retention too short to investigate an incident', () => {
		expect(() => validate({ ...prod, logRetentionDays: 1 })).toThrow(/retention/);
	});

	it('reports every problem at once rather than one per run', () => {
		let message = '';
		try {
			validate({ ...prod, databaseMultiAz: false, natGateways: 1, logRetentionDays: 1 });
		} catch (error) {
			message = (error as Error).message;
		}
		expect(message).toContain('multi-AZ');
		expect(message).toContain('zonal outage');
		expect(message).toContain('retention');
	});
});
