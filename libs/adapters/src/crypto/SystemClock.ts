import type { IClock } from '@vpn/ports';

export class SystemClock implements IClock {
	now(): Date {
		return new Date();
	}
}
