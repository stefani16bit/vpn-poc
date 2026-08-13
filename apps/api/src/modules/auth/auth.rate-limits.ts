import type { RateLimitRule } from '../../shared/rate-limit/rate-limit.service.js';

// Two numbers per rule, and the second is not the first. `limit` defends one
// address from being hammered; `ipLimit` defends the system from somebody who
// brought a list of addresses, and has to leave room for an office that shares
// one public address.
export const RATE_LIMITS = {
	login: { namespace: 'rl:login', limit: 10, ipLimit: 100, windowSeconds: 300 },
	register: { namespace: 'rl:register', limit: 5, ipLimit: 20, windowSeconds: 3600 },
	forgotPassword: { namespace: 'rl:forgot', limit: 3, ipLimit: 30, windowSeconds: 3600 },
	resendVerification: { namespace: 'rl:resend', limit: 3, ipLimit: 30, windowSeconds: 3600 },
} as const satisfies Record<string, RateLimitRule>;
