#!/usr/bin/env sh
#
# Devstack driver. Every Makefile target delegates here.
#
# The logic lives in a POSIX script rather than in the Makefile because make is
# not installed on Windows by default, and a clean clone has to come up with one
# command on every platform the team uses.
#
# Usage:
#   sh devstack/dev.sh up | down | reset | reset-registry
#   sh devstack/dev.sh reload [service]   after editing a mounted config file
#   sh devstack/dev.sh logs [service]
#   sh devstack/dev.sh check | ps | pull
#
# See: docs/06-AMBIENTE-LOCAL.md

set -e

# Git Bash rewrites anything shaped like an absolute path before docker sees it,
# which corrupts every in-container path we pass. Harmless everywhere else.
MSYS_NO_PATHCONV=1
MSYS2_ARG_CONV_EXCL='*'
export MSYS_NO_PATHCONV MSYS2_ARG_CONV_EXCL

cd "$(dirname "$0")"

WAIT_TIMEOUT=${DEVSTACK_WAIT_TIMEOUT:-300}

# Compose resolves ${VARS} against its own project directory, which is this one,
# so the root .env - the file loadEnv, check.sh and every app read - reaches no
# interpolation at all unless it is named here. Without this, a value set there
# is silently replaced by the default baked into docker-compose.yml, and the
# seeded secret disagrees with the running API for reasons nothing reports.
#
# Same two files as loadEnv. For reading, .env.local wins and so comes first;
# for compose, the last --env-file wins and so it comes last.
ENV_FILES=''
COMPOSE_ENV=''
[ -f ../.env.local ] && ENV_FILES="../.env.local"
[ -f ../.env ] && ENV_FILES="$ENV_FILES ../.env"
[ -f ../.env ] && COMPOSE_ENV="--env-file ../.env"
[ -f ../.env.local ] && COMPOSE_ENV="$COMPOSE_ENV --env-file ../.env.local"

compose() {
	# shellcheck disable=SC2086
	docker compose $COMPOSE_ENV "$@"
}

# Trailing inline comments are stripped because dotenv strips them too, and
# `BILLING_DRIVER=stripe # ...` otherwise compares equal to nothing.
read_env() {
	[ -n "$ENV_FILES" ] || return 0
	# shellcheck disable=SC2086
	sed -n "s/^$1=//p" $ENV_FILES 2>/dev/null |
		tr -d '\r' |
		head -1 |
		sed 's/[[:space:]]*#.*$//; s/[[:space:]]*$//'
}

# The Stripe CLI signs with a secret belonging to the account STRIPE_API_KEY
# names; the API verifies with whatever the vault holds. Reading one from the
# other is what stops `dev:stripe` from forwarding events the API can only
# answer 403 to - a mismatch no log on either side explains.
#
# Exported rather than written to a file: compose gives the process environment
# precedence over every env file, so 01-resources.sh seeds this exact value, and
# a changed secret recreates the container on its own.
stripe_webhook_fixture() {
	[ "$(read_env BILLING_DRIVER)" = 'stripe' ] || return 0

	key=$(read_env STRIPE_API_KEY)

	if [ -z "$key" ]; then
		printf '\nBILLING_DRIVER=stripe but STRIPE_API_KEY is unset: seeding the placeholder\n' >&2
		printf 'secret, which every forwarded event will fail to verify against.\n\n' >&2
		return 0
	fi

	if ! command -v stripe >/dev/null 2>&1; then
		printf '\nBILLING_DRIVER=stripe but the stripe CLI is not installed: seeding the\n' >&2
		printf 'placeholder secret. Install it, then re-run, before `pnpm dev:stripe`.\n\n' >&2
		return 0
	fi

	secret=$(stripe listen --api-key "$key" --print-secret 2>/dev/null | tr -d '\r' || true)

	case "$secret" in
	whsec_*)
		STRIPE_WEBHOOK_SECRET_FIXTURE="$secret"
		export STRIPE_WEBHOOK_SECRET_FIXTURE
		;;
	*)
		printf '\ncould not read a signing secret from the stripe CLI. Run `stripe login`,\n' >&2
		printf 'then re-run: until then the seeded secret is the placeholder.\n\n' >&2
		;;
	esac
}

# Docker creates a missing bind-mount source as a root-owned directory, and
# Verdaccio runs as uid 10001 - it would come up unable to write its own storage
# and fail only on the first publish, long after `up` reported green.
prepare_mounts() {
	mkdir -p verdaccio/storage
}

# `down -v` drops the postgres volume, so `up` hands back an empty database and
# the first request fails on a table that does not exist. Drizzle records what
# it applied, so running this on every up is a no-op once the schema is current.
migrate() {
	if ! command -v pnpm >/dev/null 2>&1 || [ ! -d ../node_modules ]; then
		printf '\nskipping migrations: run `pnpm install`, then `pnpm db:migrate`.\n' >&2
		return 0
	fi

	(cd .. && pnpm db:migrate)
}

case "${1:-}" in
up)
	prepare_mounts
	stripe_webhook_fixture
	# --remove-orphans because a renamed service leaves its old container holding
	# the published port, and the failure lands on whoever pulls the rename
	# rather than on whoever made it. The compose file is the whole truth about
	# this project, so there is nothing here to keep that it does not describe.
	compose up -d --wait --wait-timeout "$WAIT_TIMEOUT" --remove-orphans
	migrate
	printf '\ndevstack is up.\n'
	printf '  registry  http://localhost:%s\n' "${VERDACCIO_PORT:-24873}"
	printf '  mailbox   http://localhost:%s\n\n' "${MAILPIT_UI_PORT:-28025}"
	;;
down)
	compose down
	;;
reset)
	# Published packages survive on purpose: the Verdaccio storage is a bind
	# mount, so `down -v` cannot reach it. reset-registry is the explicit
	# opt-in for wiping it.
	compose down -v
	prepare_mounts
	stripe_webhook_fixture
	compose up -d --wait --wait-timeout "$WAIT_TIMEOUT"
	migrate
	;;
reset-registry)
	compose rm -sf verdaccio
	rm -rf verdaccio/storage
	prepare_mounts
	compose up -d --wait --wait-timeout "$WAIT_TIMEOUT" verdaccio
	;;
reload)
	shift
	stripe_webhook_fixture
	# Editing a bind-mounted config does not recreate its container, so `up`
	# happily keeps serving the previous file - the edit appears to do nothing.
	compose up -d --force-recreate --wait --wait-timeout "$WAIT_TIMEOUT" "$@"
	;;
logs)
	shift
	compose logs -f --tail 200 "$@"
	;;
ps)
	compose ps
	;;
pull)
	compose pull
	;;
check)
	sh ./check.sh
	;;
*)
	printf 'usage: sh devstack/dev.sh {up|down|reset|reset-registry|reload [service]|logs [service]|ps|pull|check}\n' >&2
	exit 2
	;;
esac
