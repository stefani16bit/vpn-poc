export type OutboxMessage =
	| { readonly kind: 'auth.verification'; readonly userId: string }
	| { readonly kind: 'auth.password_reset'; readonly userId: string }
	| { readonly kind: 'auth.welcome'; readonly userId: string }
	| {
			readonly kind: 'auth.password_changed';
			readonly userId: string;
			readonly changedAt: string;
	  }
	| {
			readonly kind: 'billing.payment_failed';
			readonly accountId: string;
			readonly externalEventId: string;
	  }
	| {
			readonly kind: 'billing.subscription_activated';
			readonly accountId: string;
			readonly externalEventId: string;
	  }
	| {
			readonly kind: 'billing.subscription_canceled';
			readonly accountId: string;
			readonly externalEventId: string;
	  }
	| {
			readonly kind: 'billing.access_revoked';
			readonly accountId: string;
			readonly externalEventId: string;
	  }
	| {
			readonly kind: 'billing.cancellation_scheduled';
			readonly accountId: string;
			readonly requestedAt: string;
			readonly endsAt: string | null;
	  }
	| {
			readonly kind: 'billing.subscription_resumed';
			readonly accountId: string;
			readonly requestedAt: string;
	  }
	| {
			readonly kind: 'billing.invoice_archive';
			readonly accountId: string;
			readonly invoiceId: string;
			readonly externalInvoiceId: string;
	  }
	| { readonly kind: 'device.provision'; readonly deviceId: string }
	| { readonly kind: 'device.revoke'; readonly publicKey: string };

export type OutboxKind = OutboxMessage['kind'];

const AUTH_KINDS: readonly OutboxKind[] = [
	'auth.verification',
	'auth.password_reset',
	'auth.welcome',
	'auth.password_changed',
];

const BILLING_KINDS: readonly OutboxKind[] = [
	'billing.payment_failed',
	'billing.subscription_activated',
	'billing.subscription_canceled',
	'billing.access_revoked',
	'billing.cancellation_scheduled',
	'billing.subscription_resumed',
	'billing.invoice_archive',
];

export const DEVICE_KINDS: readonly OutboxKind[] = ['device.provision', 'device.revoke'];

export function isDeviceKind(kind: OutboxKind): boolean {
	return DEVICE_KINDS.includes(kind);
}

export type OutboxJob = {
	readonly accountId: string;
	readonly message: OutboxMessage;
};

export function parseOutboxJob(name: string, data: unknown): OutboxJob | null {
	if (typeof data !== 'object' || data === null) return null;

	const envelope = data as { accountId?: unknown; message?: unknown };
	if (!isNonEmptyString(envelope.accountId)) return null;

	const message = parseOutboxMessage(name, envelope.message);
	if (!message) return null;

	return { accountId: envelope.accountId, message };
}

function parseOutboxMessage(name: string, data: unknown): OutboxMessage | null {
	if (typeof data !== 'object' || data === null) return null;

	const candidate = data as { userId?: unknown; accountId?: unknown };

	if (AUTH_KINDS.includes(name as OutboxKind)) {
		if (!isNonEmptyString(candidate.userId)) return null;
		return { ...candidate, kind: name } as OutboxMessage;
	}

	if (BILLING_KINDS.includes(name as OutboxKind)) {
		if (!isNonEmptyString(candidate.accountId)) return null;
		return { ...candidate, kind: name } as OutboxMessage;
	}

	if (name === 'device.provision') {
		if (!isNonEmptyString((candidate as { deviceId?: unknown }).deviceId)) return null;
		return { ...candidate, kind: name } as OutboxMessage;
	}

	if (name === 'device.revoke') {
		if (!isNonEmptyString((candidate as { publicKey?: unknown }).publicKey)) return null;
		return { ...candidate, kind: name } as OutboxMessage;
	}

	return null;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}
