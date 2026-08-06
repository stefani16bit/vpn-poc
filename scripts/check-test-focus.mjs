#!/usr/bin/env node
/**
 * Fails when a focused or skipped test is left in the tree.
 *
 * A committed `.only` turns a suite of two hundred tests into a suite of one
 * that still reports green, and nothing else in the toolchain notices. A
 * committed `.skip` is a test someone intended to come back to.
 *
 * Runs from the Claude Code Stop hook and from `pnpm verify`.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const IGNORED = new Set(['node_modules', 'dist', '.git', '.nx', 'coverage', 'cdk.out']);

// `.todo` is allowed on purpose: it is a declaration of intent that still
// reports, which is the opposite of a silent skip.
const FORBIDDEN = /\b(describe|it|test)\.(only|skip)\b/;

const findings = [];

function walk(directory) {
	for (const entry of readdirSync(directory)) {
		if (IGNORED.has(entry)) continue;

		const path = join(directory, entry);
		if (statSync(path).isDirectory()) {
			walk(path);
			continue;
		}

		if (!/\.(spec|test|contract)\.[cm]?[jt]sx?$/.test(entry)) continue;

		const lines = readFileSync(path, 'utf8').split('\n');
		for (const [index, line] of lines.entries()) {
			// Skip the line that documents the rule in this very file's siblings.
			if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue;
			if (FORBIDDEN.test(line)) {
				findings.push(`${relative(ROOT, path)}:${index + 1}: ${line.trim()}`);
			}
		}
	}
}

walk(ROOT);

if (findings.length > 0) {
	console.error('focused or skipped tests must not be committed:\n');
	for (const finding of findings) console.error(`  ${finding}`);
	console.error('\nremove .only / .skip before committing.');
	process.exit(1);
}
