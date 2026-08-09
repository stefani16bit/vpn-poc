import { afterEach, describe, expect, it, vi } from 'vitest';

import { downloadTextFile } from './download.js';

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

// jsdom implements neither of these, so the seam can only be tested by standing
// them up: without the revoke stub the call throws and the anchor never runs.
function stubObjectUrls() {
	const created: Blob[] = [];
	const revoked: string[] = [];

	vi.stubGlobal('URL', {
		...URL,
		createObjectURL: (blob: Blob) => {
			created.push(blob);
			return 'blob:stub';
		},
		revokeObjectURL: (url: string) => revoked.push(url),
	});

	return { created, revoked };
}

describe('downloadTextFile', () => {
	it('names the file and clicks a link, which is the only way a browser saves one', () => {
		stubObjectUrls();
		const clicked: HTMLAnchorElement[] = [];
		vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
			this: HTMLAnchorElement,
		) {
			clicked.push(this);
		});

		downloadTextFile('laptop.conf', '[Interface]');

		expect(clicked[0]?.download).toBe('laptop.conf');
		expect(clicked[0]?.href).toBe('blob:stub');
	});

	it('releases the object url, because a held blob keeps the key in memory', () => {
		const { revoked } = stubObjectUrls();
		vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

		downloadTextFile('laptop.conf', '[Interface]');

		expect(revoked).toEqual(['blob:stub']);
	});

	it('leaves no anchor behind in the document', () => {
		stubObjectUrls();
		vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

		downloadTextFile('laptop.conf', '[Interface]');

		expect(document.querySelectorAll('a')).toHaveLength(0);
	});
});
