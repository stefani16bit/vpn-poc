import { cadenceSchema, type Cadence } from '@vpn/contracts';

const STORAGE_KEY = 'poc-vpn.cadence';
// The verification link it travels with lasts a day; outliving that link makes it stale.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function storeIntendedCadence(cadence: Cadence): void {
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ cadence, at: Date.now() }));
	} catch {
		// a storage-less browser forgets the choice, which costs one click
	}
}

export function readIntendedCadence(): Cadence | null {
	let parsed: unknown;

	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (raw === null) return null;

		parsed = JSON.parse(raw);
	} catch {
		return null;
	}

	if (typeof parsed !== 'object' || parsed === null) return null;
	if (!('cadence' in parsed) || !('at' in parsed)) return null;
	if (typeof parsed.at !== 'number' || Date.now() - parsed.at > MAX_AGE_MS) return null;

	const cadence = cadenceSchema.safeParse(parsed.cadence);

	return cadence.success ? cadence.data : null;
}
