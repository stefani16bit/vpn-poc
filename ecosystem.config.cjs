/**
 * pm2 for local development.
 *
 * Each app is started through its own package script rather than through a
 * resolved binary path, so `pnpm dev` and `pm2 start` run exactly the same
 * command and a change to one does not silently diverge from the other.
 *
 * autorestart is off: a crash during development is information. Restarting
 * turns a stack trace into a scroll-back hunt through a restart loop.
 */

module.exports = {
	apps: [
		{
			name: 'api',
			script: 'pnpm',
			args: '--filter @vpn-poc/api dev',
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
			script: 'pnpm',
			args: '--filter @vpn-poc/web dev',
			cwd: __dirname,
			exec_mode: 'fork',
			autorestart: false,
			windowsHide: true,
			out_file: './logs/web.out.log',
			error_file: './logs/web.err.log',
		},
	],
};
