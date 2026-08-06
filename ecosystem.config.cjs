/**
 * pm2 for local development.
 *
 * Each app is started through its own package script rather than through a
 * resolved binary path, so `pnpm dev` and `pm2 start` run exactly the same
 * command and a change to one does not silently diverge from the other.
 *
 * That package script is reached through `sh -c` because pm2 cannot launch pnpm
 * directly on Windows, where it resolves to a .cmd: fork mode either require()s
 * the script as JavaScript (SyntaxError on `@ECHO off`) or, with
 * interpreter 'none', spawns it without a shell, which Node 22 rejects with
 * EINVAL. sh is already a prerequisite of the devstack, so this costs nothing on
 * the platforms where pnpm would have worked.
 *
 * autorestart is off: a crash during development is information. Restarting
 * turns a stack trace into a scroll-back hunt through a restart loop.
 */

module.exports = {
	apps: [
		{
			name: 'api',
			script: 'sh',
			args: ['-c', 'pnpm --filter @vpn-poc/api dev'],
			// Without this pm2 hands the script to node, which would try to
			// interpret sh itself as a module.
			interpreter: 'none',
			cwd: __dirname,
			// Fork, not cluster: the API holds a database pool, and cluster mode
			// would multiply it by the core count against a Postgres that has not
			// been told about it.
			exec_mode: 'fork',
			autorestart: false,
			windowsHide: true,
			out_file: './logs/api.out.log',
			error_file: './logs/api.err.log',
		},
		{
			name: 'web',
			script: 'sh',
			args: ['-c', 'pnpm --filter @vpn-poc/web dev'],
			interpreter: 'none',
			cwd: __dirname,
			exec_mode: 'fork',
			autorestart: false,
			windowsHide: true,
			out_file: './logs/web.out.log',
			error_file: './logs/web.err.log',
		},
	],
};
