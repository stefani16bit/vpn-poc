#!/usr/bin/env sh
#
# Smoke check for the devstack: one line per assertion, non-zero exit on any
# failure.
#
# `docker compose up --wait` already refuses to return until every container
# healthcheck is green, so this script deliberately asserts the next layer up:
# that the published ports answer from the host, and that the services capable
# of being green while wrong are made to prove otherwise.
#
# Usage: sh devstack/check.sh
#
# See: docs/06-AMBIENTE-LOCAL.md

# Git Bash rewrites anything shaped like an absolute path before docker sees it,
# turning every in-container path into nonsense. Harmless everywhere else.
MSYS_NO_PATHCONV=1
MSYS2_ARG_CONV_EXCL='*'
export MSYS_NO_PATHCONV MSYS2_ARG_CONV_EXCL

cd "$(dirname "$0")" || exit 1

TIMEOUT=${DEVSTACK_PROBE_TIMEOUT:-5}

VERDACCIO_PORT=${VERDACCIO_PORT:-24873}
LOCALSTACK_PORT=${LOCALSTACK_PORT:-24566}
LOCALSTRIPE_PORT=${LOCALSTRIPE_PORT:-28420}
MAILPIT_UI_PORT=${MAILPIT_UI_PORT:-28025}
CADDY_HTTPS_PORT=${CADDY_HTTPS_PORT:-20443}

PASSED=0
FAILED=0

pass() {
	PASSED=$((PASSED + 1))
	printf '  PASS  %s\n' "$1"
}

fail() {
	FAILED=$((FAILED + 1))
	printf '  FAIL  %s\n' "$1"
	printf '        %s\n' "$2"
}

# Body match rather than status code: several of these endpoints answer 200
# while reporting a degraded component in the payload.
check_body() {
	_label=$1
	_needle=$2
	shift 2
	_body=$(curl -s --max-time "$TIMEOUT" "$@" 2>/dev/null)
	case "$_body" in
	*"$_needle"*) pass "$_label" ;;
	'') fail "$_label" "no response from $*" ;;
	*) fail "$_label" "response did not contain '$_needle'" ;;
	esac
}

check_status() {
	_label=$1
	_expected=$2
	shift 2
	_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time "$TIMEOUT" "$@" 2>/dev/null)
	[ -z "$_code" ] && _code=000
	if [ "$_code" = "$_expected" ]; then
		pass "$_label"
	else
		fail "$_label" "expected HTTP $_expected, got $_code"
	fi
}

check_exec() {
	_label=$1
	_needle=$2
	shift 2
	_out=$(docker compose exec -T "$@" 2>&1)
	case "$_out" in
	*"$_needle"*) pass "$_label" ;;
	*) fail "$_label" "'$_needle' not in output: $(printf '%s' "$_out" | tr '\n' ' ' | cut -c1-120)" ;;
	esac
}

printf '\ndevstack check\n\n'

if ! docker compose ps >/dev/null 2>&1; then
	printf '  FAIL  docker compose cannot read this project\n'
	printf '        run it from a clone with devstack/docker-compose.yml, and check Docker is running\n\n'
	exit 1
fi

check_exec 'postgres accepts connections' 'accepting connections' \
	postgres pg_isready -h 127.0.0.1 -U postgres -d poc_vpn_dev

check_exec 'postgres has the four roles' '4' \
	postgres psql -U postgres -d poc_vpn_dev -tAc \
	"SELECT count(*) FROM pg_roles WHERE rolname IN ('vpn_migrator','vpn_app','app_system','vpn_readonly')"

# A superuser or BYPASSRLS role silently defeats every policy written later,
# while the policies still read as correct. Assert it now, not after the leak.
check_exec 'vpn_app cannot bypass RLS' 'CONFINED' \
	postgres psql -U postgres -d poc_vpn_dev -tAc \
	"SELECT CASE WHEN rolsuper OR rolbypassrls THEN 'ESCAPES' ELSE 'CONFINED' END FROM pg_roles WHERE rolname='vpn_app'"

check_exec 'redis answers PING' 'PONG' redis redis-cli ping

check_status 'verdaccio serves its registry API' 200 \
	"http://localhost:${VERDACCIO_PORT}/-/ping"

# The title comes from verdaccio/config.yaml, so this asserts both that the UI
# opens in a browser and that our config was loaded rather than the image default.
check_body 'verdaccio web UI serves the configured registry' 'poc-vpn registry' \
	"http://localhost:${VERDACCIO_PORT}/"

check_body 'localstack has s3, sqs, sns and secretsmanager' '"secretsmanager"' \
	"http://localhost:${LOCALSTACK_PORT}/_localstack/health"

check_exec 'localstack seeded the object storage bucket' 'poc-vpn-assets' \
	localstack awslocal s3 ls

check_exec 'localstack seeded the notifications queue with a DLQ' 'poc-vpn-notifications-dlq' \
	localstack awslocal sqs list-queues

check_status 'localstripe answers the Stripe API' 200 \
	-u 'sk_test_local:' "http://localhost:${LOCALSTRIPE_PORT}/v1/customers"

check_status 'mailpit is ready to accept mail' 200 \
	"http://localhost:${MAILPIT_UI_PORT}/readyz"

# -k is deliberate: `tls internal` signs with Caddy's own CA, which is not in
# the OS trust store. --resolve is required because browsers resolve *.localhost
# internally but the Windows resolver does not, and curl uses the OS resolver.
check_body 'app.localhost terminates TLS and routes by Host' 'ok' \
	-k --resolve "app.localhost:${CADDY_HTTPS_PORT}:127.0.0.1" \
	"https://app.localhost:${CADDY_HTTPS_PORT}/__devstack/health"

printf '\n%s passed, %s failed\n\n' "$PASSED" "$FAILED"
[ "$FAILED" -eq 0 ] || exit 1
