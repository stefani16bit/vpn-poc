const UNIQUE_VIOLATION = '23505';
// what `RAISE ... USING ERRCODE = 'restrict_violation'` reports
const RESTRICT_VIOLATION = '23001';
// what a FOREIGN KEY ... ON DELETE RESTRICT reports. A trigger and a foreign key
// refuse the same deletion for the same reason and must read the same to a
// caller, or one of them turns a 409 into a 500.
const FOREIGN_KEY_VIOLATION = '23503';

export function isUniqueViolation(error: unknown, constraint: string): boolean {
	if (typeof error !== 'object' || error === null) return false;

	const candidate = error as { code?: unknown; constraint_name?: unknown };

	return candidate.code === UNIQUE_VIOLATION && candidate.constraint_name === constraint;
}

export function isRestrictViolation(error: unknown): boolean {
	if (typeof error !== 'object' || error === null) return false;

	const code = (error as { code?: unknown }).code;

	return code === RESTRICT_VIOLATION || code === FOREIGN_KEY_VIOLATION;
}
