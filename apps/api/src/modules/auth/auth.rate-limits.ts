import type { RateLimitRule } from '../../shared/rate-limit/rate-limit.service.js';

export const RATE_LIMITS = {
	login: { namespace: 'rl:login', limit: 10, windowSeconds: 300 },
	register: { namespace: 'rl:register', limit: 5, windowSeconds: 3600 },
	forgotPassword: { namespace: 'rl:forgot', limit: 3, windowSeconds: 3600 },
	resendVerification: { namespace: 'rl:resend', limit: 3, windowSeconds: 3600 },
} as const satisfies Record<string, RateLimitRule>;
