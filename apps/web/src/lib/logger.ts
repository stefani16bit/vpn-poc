const SENSITIVE_KEYS = [
	'password',
	'newpassword',
	'token',
	'accesstoken',
	'refreshtoken',
	'resettoken',
	'code',
	'otp',
	'secret',
	'authorization',
];

const PREFIX = '[poc-vpn]';

function redact(value: unknown, depth = 0): unknown {
	if (depth > 5 || value === null || typeof value !== 'object') return value;
	if (Array.isArray(value)) return value.map((entry) => redact(entry, depth + 1));

	const output: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
		output[key] = SENSITIVE_KEYS.includes(key.toLowerCase())
			? '[REDACTED]'
			: redact(entry, depth + 1);
	}
	return output;
}

const isDev = import.meta.env.DEV;

export const logger = {
	info(message: string, context?: Record<string, unknown>): void {
		if (!isDev) return;
		console.info(PREFIX, message, context ? redact(context) : '');
	},
	warn(message: string, context?: Record<string, unknown>): void {
		console.warn(PREFIX, message, context ? redact(context) : '');
	},
	error(message: string, context?: Record<string, unknown>): void {
		console.error(PREFIX, message, context ? redact(context) : '');
	},
	group(label: string, entries: Record<string, unknown>): void {
		if (!isDev) return;
		console.groupCollapsed(PREFIX, label);
		for (const [key, value] of Object.entries(entries)) {
			console.info(key, redact(value));
		}
		console.groupEnd();
	},
};
