export interface RotationCandidate {
	readonly familyId: string;
	readonly userId: string;
	readonly accountId: string;
	readonly spentAt: Date | null;
	readonly expiresAt: Date;
	readonly revokedAt: Date | null;
}

export type RotationDecision =
	| {
			readonly kind: 'rotate';
			readonly familyId: string;
			readonly userId: string;
			readonly accountId: string;
	  }
	| { readonly kind: 'revoke_family'; readonly familyId: string }
	| { readonly kind: 'reject' };

export function decideRotation(
	candidate: RotationCandidate | undefined,
	now: Date,
): RotationDecision {
	if (!candidate) return { kind: 'reject' };
	if (candidate.revokedAt !== null) return { kind: 'reject' };
	if (candidate.spentAt !== null) return { kind: 'revoke_family', familyId: candidate.familyId };
	if (candidate.expiresAt.getTime() <= now.getTime()) return { kind: 'reject' };

	return {
		kind: 'rotate',
		familyId: candidate.familyId,
		userId: candidate.userId,
		accountId: candidate.accountId,
	};
}
