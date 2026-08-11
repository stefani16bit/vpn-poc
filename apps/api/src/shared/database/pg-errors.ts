const UNIQUE_VIOLATION = '23505';
// what `RAISE ... USING ERRCODE = 'restrict_violation'` reports
const RESTRICT_VIOLATION = '23001';

export function isUniqueViolation(error: unknown, constraint: string): boolean {
	if (typeof error !== 'object' || error === null) return false;

	const candidate = error as { code?: unknown; constraint_name?: unknown };

	return candidate.code === UNIQUE_VIOLATION && candidate.constraint_name === constraint;
}

export function isRestrictViolation(error: unknown): boolean {
	if (typeof error !== 'object' || error === null) return false;

	return (error as { code?: unknown }).code === RESTRICT_VIOLATION;
}
