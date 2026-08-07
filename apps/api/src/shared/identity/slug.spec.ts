import { describe, expect, it } from 'vitest';

import { deriveSlug, slugCandidate } from './slug.js';

describe('deriveSlug', () => {
	it('takes the local part of the address', () => {
		expect(deriveSlug('ada@example.com')).toBe('ada');
	});

	it('lowercases', () => {
		expect(deriveSlug('Ada@Example.com')).toBe('ada');
	});

	it('strips diacritics rather than replacing them with hyphens', () => {
		expect(deriveSlug('joão.gonçalves@example.com')).toBe('joao-goncalves');
	});

	it('collapses runs of punctuation into a single hyphen', () => {
		expect(deriveSlug('ada..lovelace+tag@example.com')).toBe('ada-lovelace-tag');
	});

	it('trims hyphens from both ends', () => {
		expect(deriveSlug('.ada.@example.com')).toBe('ada');
	});

	it('falls back when the local part has nothing usable', () => {
		expect(deriveSlug('...@example.com')).toBe('account');
	});

	it('truncates to the maximum length', () => {
		expect(deriveSlug(`${'a'.repeat(60)}@example.com`)).toHaveLength(40);
	});

	it('does not leave a trailing hyphen when the cut lands on a separator', () => {
		const slug = deriveSlug(`${'a'.repeat(39)}.b@example.com`);
		expect(slug.endsWith('-')).toBe(false);
		expect(slug).toBe('a'.repeat(39));
	});

	it('survives an address with no at sign', () => {
		expect(deriveSlug('ada')).toBe('ada');
	});
});

describe('slugCandidate', () => {
	it('offers the base slug first', () => {
		expect(slugCandidate('ada', 0)).toBe('ada');
	});

	it('numbers from two, so the first collision reads as the second account', () => {
		expect(slugCandidate('ada', 1)).toBe('ada-2');
		expect(slugCandidate('ada', 2)).toBe('ada-3');
	});

	it('never offers a reserved slug, and skips straight to the suffixed form', () => {
		expect(slugCandidate('api', 0)).toBe('api-2');
		expect(slugCandidate('api', 1)).toBe('api-3');
	});

	it('produces no duplicate candidate for a reserved base', () => {
		const offered = [0, 1, 2, 3].map((attempt) => slugCandidate('api', attempt));
		expect(new Set(offered).size).toBe(offered.length);
	});

	it('gives up on counting after nine and switches to a random suffix', () => {
		expect(slugCandidate('ada', 9)).toBe('ada-10');
		expect(slugCandidate('ada', 10, () => 'deadbeef')).toBe('ada-deadbeef');
	});

	it('keeps using a fresh random suffix past the numbered range', () => {
		expect(slugCandidate('ada', 25, () => 'cafe1234')).toBe('ada-cafe1234');
	});
});
