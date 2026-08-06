import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createModuleFanout, moduleLogFile } from './module-fanout-stream.js';

let dir: string;
let combined: string;

function record(module: string | undefined, msg: string): string {
	return `${JSON.stringify({ level: 30, time: 0, msg, ...(module === undefined ? {} : { module }) })}\n`;
}

function read(path: string): string {
	return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'fanout-'));
	combined = join(dir, 'api.ndjson');
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe('module fanout stream', () => {
	it('names a module file next to the combined one', () => {
		expect(moduleLogFile('logs/api.ndjson', 'auth')).toBe('logs/api.auth.ndjson');
	});

	it('writes every line to the combined file so a trace stays whole', () => {
		const fanout = createModuleFanout({ combined });

		fanout.write(record('auth', 'one'));
		fanout.write(record('billing', 'two'));

		expect(read(combined)).toContain('one');
		expect(read(combined)).toContain('two');
	});

	it('splits each line into the file of the module that emitted it', () => {
		const fanout = createModuleFanout({ combined });

		fanout.write(record('auth', 'one'));
		fanout.write(record('billing', 'two'));

		expect(read(moduleLogFile(combined, 'auth'))).toContain('one');
		expect(read(moduleLogFile(combined, 'auth'))).not.toContain('two');
		expect(read(moduleLogFile(combined, 'billing'))).toContain('two');
	});

	it('leaves no file behind for a module that never logged', () => {
		const fanout = createModuleFanout({ combined });

		fanout.write(record('auth', 'one'));

		expect(existsSync(moduleLogFile(combined, 'billing'))).toBe(false);
	});

	it('opens nothing until a line arrives, so building the config truncates no trace', () => {
		createModuleFanout({ combined });

		expect(existsSync(combined)).toBe(false);
	});

	it('files an unattributed line under system rather than dropping it', () => {
		const fanout = createModuleFanout({ combined });

		fanout.write(record(undefined, 'orphan'));
		fanout.write(record('smuggled', 'forged'));

		expect(read(moduleLogFile(combined, 'system'))).toContain('orphan');
		expect(read(moduleLogFile(combined, 'system'))).toContain('forged');
	});

	it('keeps a half-written line out of the split without losing it', () => {
		const fanout = createModuleFanout({ combined });

		expect(() => fanout.write('{"level":30,"msg":"trunc')).not.toThrow();
		expect(read(combined)).toContain('trunc');
	});

	it('renders the pretty line only when asked, and only to stdout', () => {
		const seen: string[] = [];
		const fanout = createModuleFanout({
			combined,
			pretty: { colorize: false, singleLine: true },
			out: (line) => seen.push(line),
		});

		fanout.write(record('auth', 'one'));

		expect(seen.join('')).toContain('one');
		expect(read(moduleLogFile(combined, 'auth'))).toContain('"msg":"one"');
	});
});
