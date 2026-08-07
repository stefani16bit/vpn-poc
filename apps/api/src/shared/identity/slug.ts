import { randomBytes } from 'node:crypto';

const RESERVED_SLUGS: ReadonlySet<string> = new Set([
	'admin',
	'api',
	'app',
	'auth',
	'billing',
	'mail',
	'static',
	'www',
]);

const MAX_LENGTH = 40;
const NUMBERED_ATTEMPTS = 9;
const FALLBACK_SLUG = 'account';

export function deriveSlug(email: string): string {
	const localPart = email.split('@')[0] ?? '';

	const slug = localPart
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.slice(0, MAX_LENGTH)
		.replace(/^-+|-+$/g, '');

	return slug.length > 0 ? slug : FALLBACK_SLUG;
}

export function slugCandidate(
	base: string,
	attempt: number,
	suffix: () => string = randomSuffix,
): string {
	const index = RESERVED_SLUGS.has(base) ? attempt + 1 : attempt;

	if (index === 0) return base;
	if (index <= NUMBERED_ATTEMPTS) return `${base}-${index + 1}`;

	return `${base}-${suffix()}`;
}

export function isReservedSlug(slug: string): boolean {
	return RESERVED_SLUGS.has(slug);
}

function randomSuffix(): string {
	return randomBytes(4).toString('hex');
}
