export interface HealthIndicator {
	readonly name: string;
	check(): Promise<void>;
}

export const HEALTH_INDICATORS: unique symbol = Symbol.for('vpn.health-indicators');
