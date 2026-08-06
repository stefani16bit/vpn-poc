import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library only auto-registers its cleanup when vitest globals are on,
// and they are off here; without this every render accumulates in the document
// and the second test in a file sees two of everything.
afterEach(cleanup);

// Radix builds on pointer capture and scroll-into-view, which jsdom does not
// implement; without these a Select throws and the failure reads as a bug in
// the component rather than in the environment.
if (typeof Element !== 'undefined') {
	Element.prototype.hasPointerCapture ??= () => false;
	Element.prototype.setPointerCapture ??= () => undefined;
	Element.prototype.releasePointerCapture ??= () => undefined;
	Element.prototype.scrollIntoView ??= () => undefined;
}

globalThis.ResizeObserver ??= class {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
};
