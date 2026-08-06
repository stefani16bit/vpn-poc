export type HealthStatus = 'ok' | 'failed';

export interface HealthIndicator {
	readonly name: string;
	check(): Promise<void>;
}

export const HEALTH_INDICATORS: unique symbol = Symbol.for('vpn.health-indicators');

export interface HealthReport {
	readonly status: 'ok' | 'degraded';
	readonly checks: Readonly<Record<string, HealthStatus>>;
}
