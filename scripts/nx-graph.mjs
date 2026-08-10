#!/usr/bin/env node
import { createProjectGraphAsync, readCachedProjectGraph } from 'nx/src/devkit-exports.js';

function fail(reason) {
	console.error(
		`the Nx project graph is unusable, so @nx/enforce-module-boundaries would skip every ` +
			`tag constraint and lint would still exit 0.\n${reason}`,
	);
	process.exit(1);
}

try {
	await createProjectGraphAsync({ exitOnError: false });
} catch (error) {
	fail(error instanceof Error ? error.message : String(error));
}

let graph;
try {
	graph = readCachedProjectGraph();
} catch (error) {
	fail(error instanceof Error ? error.message : String(error));
}

if (Object.keys(graph.nodes).length === 0) {
	fail('the cached graph has no projects.');
}
