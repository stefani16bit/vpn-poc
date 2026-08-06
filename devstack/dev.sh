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

# Docker creates a missing bind-mount source as a root-owned directory, and
# Verdaccio runs as uid 10001 - it would come up unable to write its own storage
# and fail only on the first publish, long after `up` reported green.
prepare_mounts() {
	mkdir -p verdaccio/storage
}

case "${1:-}" in
up)
	prepare_mounts
	docker compose up -d --wait --wait-timeout "$WAIT_TIMEOUT"
	printf '\ndevstack is up.\n'
	printf '  registry  http://localhost:%s\n' "${VERDACCIO_PORT:-24873}"
	printf '  mailbox   http://localhost:%s\n\n' "${MAILPIT_UI_PORT:-28025}"
	;;
down)
	docker compose down
	;;
reset)
	# Published packages survive on purpose: the Verdaccio storage is a bind
	# mount, so `down -v` cannot reach it. reset-registry is the explicit
	# opt-in for wiping it.
	docker compose down -v
	prepare_mounts
	docker compose up -d --wait --wait-timeout "$WAIT_TIMEOUT"
	;;
reset-registry)
	docker compose rm -sf verdaccio
	rm -rf verdaccio/storage
	prepare_mounts
	docker compose up -d --wait --wait-timeout "$WAIT_TIMEOUT" verdaccio
	;;
reload)
	shift
	# Editing a bind-mounted config does not recreate its container, so `up`
	# happily keeps serving the previous file - the edit appears to do nothing.
	docker compose up -d --force-recreate --wait --wait-timeout "$WAIT_TIMEOUT" "$@"
	;;
logs)
	shift
	docker compose logs -f --tail 200 "$@"
	;;
ps)
	docker compose ps
	;;
pull)
	docker compose pull
	;;
check)
	sh ./check.sh
	;;
*)
	printf 'usage: sh devstack/dev.sh {up|down|reset|reset-registry|reload [service]|logs [service]|ps|pull|check}\n' >&2
	exit 2
	;;
esac
