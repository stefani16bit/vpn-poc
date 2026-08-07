export type OutboxMessage =
	| { readonly kind: 'auth.verification'; readonly accountId: string }
	| { readonly kind: 'auth.password_reset'; readonly accountId: string }
	| { readonly kind: 'auth.welcome'; readonly accountId: string }
	| {
			readonly kind: 'auth.password_changed';
			readonly accountId: string;
			readonly changedAt: string;
	  }
	| {
			readonly kind: 'billing.payment_failed';
			readonly accountId: string;
			readonly externalEventId: string;
	  }
	| {
			readonly kind: 'billing.subscription_canceled';
			readonly accountId: string;
			readonly externalEventId: string;
			readonly endsAt: string | null;
	  };

export type OutboxKind = OutboxMessage['kind'];

const KINDS: readonly OutboxKind[] = [
	'auth.verification',
	'auth.password_reset',
	'auth.welcome',
	'auth.password_changed',
	'billing.payment_failed',
	'billing.subscription_canceled',
];

export function parseOutboxMessage(name: string, data: unknown): OutboxMessage | null {
	if (!KINDS.includes(name as OutboxKind)) return null;
	if (typeof data !== 'object' || data === null) return null;

	const candidate = data as { accountId?: unknown };
	if (typeof candidate.accountId !== 'string' || candidate.accountId.length === 0) return null;

	return { ...candidate, kind: name } as OutboxMessage;
}
