export type UserRole = 'owner' | 'admin' | 'member';

export interface User {
	readonly id: string;
	readonly accountId: string;
	readonly email: string;
	readonly role: UserRole;
	readonly emailVerifiedAt: Date | null;
	readonly locale: string;
	readonly createdAt: Date;
}

export interface Session {
	readonly userId: string;
	readonly accountId: string;
	readonly sessionId: string;
	readonly refreshToken: string;
	readonly expiresAt: Date;
}

export type RegisterOutcome =
	{ readonly kind: 'registered'; readonly user: User } | { readonly kind: 'email_taken' };

export type RefreshOutcome =
	| { readonly kind: 'rotated'; readonly session: Session }
	| { readonly kind: 'reuse_detected'; readonly sessionId: string }
	| { readonly kind: 'rejected' };
