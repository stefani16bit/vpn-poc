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

# The public half of the throwaway pair in wireguard/peers/. Asserting the value
# rather than a peer count is what makes a silently empty wg0.conf fail here.
WIREGUARD_PEER_PUBLIC_KEY='StZtsGF+hrd7nHOYtH0GhM/759qnBuUbKdVMEeFyLVU='

# The name is a constant on both sides: the node has no user directory, so the
# shared token is the password. DEC-073.
EXIT_NODE_API_USER='worker'

# The fleet, as name:control-port:tunnel-address. One region per node, and the
# only one wired to the canary is the first: that asymmetry is what the last
# assertion of the loop below exists to prove.
FLEET='sa:21821:10.13.13.1:na na:21831:10.13.14.1:eu eu:21841:10.13.15.1:as as:21851:10.13.16.1:af af:21861:10.13.17.1:sa'
CANARY_NODE='sa'

# The canary node's pinned foot in that network. Every canary assertion here is
# about poc-vpn alone: this file has to stay green on a machine that has never
# heard of the canary repository. DEC-075.
CANARY_NODE_ADDRESS='172.30.13.2/24'
CANARY_SUBNET='172.30.13.'

# The adjacency, not merely the presence of both rules. POSTROUTING is evaluated
# in insertion order, so a RETURN appended after the MASQUERADE would leave every
# private resource seeing the node's address instead of the device's — a failure
# that answers 200 and loses the only fact worth having.
#
# Both rules match on destination. Which interface Docker hands each network is
# not guaranteed, and this stack is the proof: eth0 is the canary network here,
# not the default one. DEC-088.
POSTROUTING_ORDER='-s 10.13.13.0/24 -d 172.30.13.0/24 -j RETURN -A POSTROUTING -s 10.13.13.0/24 ! -d 10.13.13.0/24 -j MASQUERADE'

ENV_FILES=''
[ -f ../.env.local ] && ENV_FILES="${ENV_FILES} ../.env.local"
[ -f ../.env ] && ENV_FILES="${ENV_FILES} ../.env"

# Read from the same two files loadEnv reads, in the same order, rather than from
# a default: that is what makes the exit node probe below prove the token the
# application will send is the token the node accepts. A mismatch is otherwise a
# silent 401 inside the worker.
read_env() {
	# shellcheck disable=SC2086
	[ -n "$ENV_FILES" ] && sed -n "s/^$1=//p" $ENV_FILES 2>/dev/null | tr -d '\r' | head -1
}

# Read from Secrets Manager rather than from the root .env. That is what turns
# the probe below from "the env file and the node agree" into "the secret store,
# the compose interpolation, the node's httpd.conf and the published port all
# agree" — which is the chain the API walks at runtime.
node_credential() {
	docker compose exec -T localstack awslocal secretsmanager get-secret-value \
		--secret-id "poc-vpn/exit-node/$1" --version-stage "${2:-AWSCURRENT}" \
		--query SecretString --output text 2>/dev/null |
		tr -d '\r\n'
}

# The httpd the control plane runs on. Compared before and after a rotation,
# because "without restarting" is the claim item 3 makes and a container that
# quietly came back up would satisfy every other probe in this file.
node_httpd_pid() {
	docker compose exec -T "wireguard-$1" pidof httpd 2>/dev/null | tr -d '\r\n'
}

# Straight from the interface, not from describe(): this is the value the seeded
# row is checked against, so reading it through the same control plane the row
# points at would make the comparison agree with itself.
node_public_key() {
	docker compose exec -T "wireguard-$1" wg show wg0 public-key 2>/dev/null | tr -d '\r\n'
}

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

# The same probe read the other way. An absence has to fail when the command
# itself fails, or a container that will not exec at all reports as proof that
# the thing is not there.
check_exec_absent() {
	_label=$1
	_needle=$2
	shift 2
	if ! _out=$(docker compose exec -T "$@" 2>&1); then
		fail "$_label" "could not run the probe: $(printf '%s' "$_out" | tr '\n' ' ' | cut -c1-120)"
		return
	fi

	case "$_out" in
	*"$_needle"*) fail "$_label" "'$_needle' was present in the output" ;;
	*) pass "$_label" ;;
	esac
}

# A key declared in .env.example and absent from the local env is a difference
# between what the documentation describes and what runs, and it surfaces much
# later as a handler throwing. Names are compared, never values.
#
# Both files are searched because loadEnv reads .env.local first and then .env,
# so a key set in either one is set.
check_env_drift() {
	_label='the local env declares every key .env.example does'

	if [ -z "$ENV_FILES" ]; then
		fail "$_label" 'no .env or .env.local at the repository root; copy .env.example'
		return
	fi

	_absent=''
	for _key in $(grep -oE '^[A-Z_][A-Z0-9_]*=' ../.env.example | tr -d '=' | sort -u); do
		# shellcheck disable=SC2086
		grep -qhE "^${_key}=" $ENV_FILES || _absent="${_absent}${_key} "
	done

	if [ -z "$_absent" ]; then
		pass "$_label"
	else
		fail "$_label" "absent from${ENV_FILES}: ${_absent}"
	fi
}

printf '\ndevstack check\n\n'

if ! docker compose ps >/dev/null 2>&1; then
	printf '  FAIL  docker compose cannot read this project\n'
	printf '        run it from a clone with devstack/docker-compose.yml, and check Docker is running\n\n'
	exit 1
fi

check_exec 'postgres accepts connections' 'accepting connections' \
	postgres pg_isready -h 127.0.0.1 -U postgres -d poc_vpn_dev

# The four the running system needs. `vpn_admin` is a human's login and is left
# out on purpose: it fails loudly at a connection dialog, while these four fail
# where nobody is looking.
check_exec 'postgres has the four application roles' '4' \
	postgres psql -U postgres -d poc_vpn_dev -tAc \
	"SELECT count(*) FROM pg_roles WHERE rolname IN ('vpn_migrator','vpn_app','app_system','vpn_readonly')"

# A superuser or BYPASSRLS role silently defeats every policy written later,
# while the policies still read as correct. Assert it now, not after the leak.
check_exec 'vpn_app cannot bypass RLS' 'CONFINED' \
	postgres psql -U postgres -d poc_vpn_dev -tAc \
	"SELECT CASE WHEN rolsuper OR rolbypassrls THEN 'ESCAPES' ELSE 'CONFINED' END FROM pg_roles WHERE rolname='vpn_app'"

# A table added without a policy is the failure DEC-035's per-table mandate
# exists to prevent, and it is invisible until something leaks. The mandate has
# exactly two named exceptions — the fleet is the platform's and hangs off no
# account — so this asserts the set rather than counting zero: a third table
# without RLS fails, and switching RLS on for one of these two fails too.
check_exec 'only the platform fleet sits outside RLS' 'exit_nodes,regions' \
	postgres psql -U postgres -d poc_vpn_dev -tAc \
	"SELECT coalesce(string_agg(c.relname, ',' ORDER BY c.relname), '') FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname <> '__drizzle_migrations' AND NOT c.relrowsecurity"

# The REVOKE is what makes "platform table" a fact instead of a naming
# convention: without it the default privileges hand vpn_app INSERT, UPDATE and
# DELETE, and dropping the policy would have widened the tenant role, not
# narrowed it.
check_exec 'the tenant role may read the fleet and nothing else' 'READONLY' \
	postgres psql -U postgres -d poc_vpn_dev -tAc \
	"SELECT CASE WHEN bool_and(has_table_privilege('vpn_app', t, 'SELECT')) AND NOT bool_or(has_table_privilege('vpn_app', t, 'INSERT') OR has_table_privilege('vpn_app', t, 'UPDATE') OR has_table_privilege('vpn_app', t, 'DELETE')) THEN 'READONLY' ELSE 'WRITABLE' END FROM unnest(ARRAY['regions','exit_nodes']) AS t"

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

for _entry in $FLEET; do
	_node=${_entry%%:*}
	_rest=${_entry#*:}
	_port=${_rest%%:*}
	_rest=${_rest#*:}
	_tunnel=${_rest%%:*}
	_neighbour=${_rest##*:}
	_credential=$(node_credential "$_node")

	# Proves the interface exists and that wg0.conf was read. A container that
	# came up without NET_ADMIN has no wg0 at all.
	check_exec "the ${_node} node has its tunnel up" "$_tunnel" \
		"wireguard-${_node}" ip -4 -o addr show dev wg0

	# The rules asserted as text below; this asserts that one of them fires. The
	# two are not the same assertion, and only this one fails when the rule
	# matches an interface that stopped being the way out: the packet leaves
	# unmasqueraded and every textual probe stays green. Sourced from the tunnel
	# and aimed at another container by name, because that is the path
	# data-plane.md's NAT probe uses.
	#
	# No reply is needed — NAT happens on the way out — so this asserts the
	# counter, not reachability.
	check_exec "the ${_node} node masquerades tunnel traffic whatever interface it leaves by" 'MASQUERADED' \
		"wireguard-${_node}" sh -c "iptables -t nat -Z POSTROUTING >/dev/null;
			ping -c 1 -W 2 -I ${_tunnel} verdaccio >/dev/null 2>&1;
			iptables -t nat -L POSTROUTING -v -n | awk '/MASQUERADE/ && \$1 > 0 { print \"MASQUERADED\" }'"

	# From the host, not from inside: the worker reaches each node over its own
	# published port, and a control plane bound to the wrong interface passes
	# every in-container probe there is.
	check_body "the ${_node} control plane answers the credential Secrets Manager holds for it" 'publicKey=' \
		-u "${EXIT_NODE_API_USER}:${_credential}" \
		"http://127.0.0.1:${_port}/cgi-bin/describe"

	# The other half of the window. Every node here stands mid-rotation, because a
	# window nobody has to arrange is a window every run checks. This is also the
	# assertion that would have caught busybox keeping only one of two config
	# lines for the same path — the thing DEC-098 could not promise. DEC-102.
	check_body "the ${_node} control plane accepts the credential it is rotating away from" 'publicKey=' \
		-u "${EXIT_NODE_API_USER}:$(node_credential "$_node" AWSPREVIOUS)" \
		"http://127.0.0.1:${_port}/cgi-bin/describe"

	# The assertion that actually earns the per-node credential. Without it five
	# identical tokens would pass every other probe in this file, including the
	# positive one above.
	check_status "the ${_node} control plane refuses the credential of ${_neighbour}" 401 \
		-u "${EXIT_NODE_API_USER}:$(node_credential "$_neighbour")" \
		"http://127.0.0.1:${_port}/cgi-bin/describe"

	# The whole point of DEC-073. An unauthenticated caller that gets 200 here can
	# add or remove any peer, and every other probe in this file stays green while
	# it can.
	check_status "the ${_node} control plane refuses an anonymous caller" 401 \
		"http://127.0.0.1:${_port}/cgi-bin/describe"

	# This is where the custody rule lives now. Nothing calls describe() before
	# writing a row any more — the fleet is seeded — so what keeps the seeded key
	# honest is asking the machine on every run. Registration proved it once, at
	# insert; this proves it every time. DEC-100.
	check_exec "the ${_node} row carries the key the machine answers with" 'MATCHES' \
		postgres psql -U postgres -d poc_vpn_dev -tAc \
		"SELECT CASE WHEN public_key = '$(node_public_key "$_node")' THEN 'MATCHES' ELSE 'DRIFTED' END FROM exit_nodes WHERE label = '${_node}-01'"

	# The negative that makes a region mean something. Four of the five have no
	# address in the canary subnet, and that absence — not a rule anybody can
	# misconfigure — is why a key created in their region reaches nothing there.
	# Asserted as the cause rather than as a failed ping, so it stays a real
	# assertion on a machine where the canary is not running at all.
	if [ "$_node" != "$CANARY_NODE" ]; then
		check_exec_absent "the ${_node} node has no foot in the canary network" "$CANARY_SUBNET" \
			"wireguard-${_node}" ip -4 -o addr show
	fi
done

# The seeded peer and the two rules that only the canary node carries.
check_exec 'the canary node has the seeded peer on the tunnel' "$WIREGUARD_PEER_PUBLIC_KEY" \
	"wireguard-${CANARY_NODE}" wg show wg0 peers

check_exec 'the canary node has its pinned address on the canary network' "$CANARY_NODE_ADDRESS" \
	"wireguard-${CANARY_NODE}" ip -4 -o addr show

check_exec 'the canary node returns canary traffic before it masquerades the rest' "$POSTROUTING_ORDER" \
	"wireguard-${CANARY_NODE}" sh -c "iptables -t nat -S POSTROUTING | tr '\n' ' '"

# A partial seed has to fail. Four credentials and one missing is a node the
# worker cannot reach, and it would be discovered much later and far away.
check_exec 'localstack seeded a credential for every exit node' 'credentials=5' \
	localstack sh -c "awslocal secretsmanager list-secrets --output text \
		--query 'length(SecretList[?starts_with(Name, \`poc-vpn/exit-node/\`)])' |
		sed 's/^/credentials=/'"

# The refs the API resolves at boot. It reads these instead of its own
# environment now, so a missing one is a container that will not start — and the
# ref names live in .env while the values live here, which is the join that
# nothing else checks.
check_exec 'the signing secret resolves at the ref the api reads' 'signing=1' \
	localstack sh -c "awslocal secretsmanager get-secret-value \
		--secret-id '$(read_env AUTH_JWT_SECRET_REF)' --query SecretString --output text |
		wc -l | tr -d ' ' | sed 's/^/signing=/'"

# The standing rotation window. Seeded twice on purpose (01-resources.sh), so a
# token signed before a rotation is a state this stack is always in rather than
# one somebody has to arrange to test.
check_exec 'the signing secret carries the value a rotation retired' 'previous=1' \
	localstack sh -c "awslocal secretsmanager get-secret-value \
		--secret-id '$(read_env AUTH_JWT_SECRET_REF)' --version-stage AWSPREVIOUS \
		--query SecretString --output text | wc -l | tr -d ' ' | sed 's/^/previous=/'"

# Seeded even though billing runs on the memory driver here (DEC-009): what
# breaks in a deploy is the ref not resolving, and that is checkable offline.
check_exec 'the billing webhook secret resolves at its ref' 'webhook=1' \
	localstack sh -c "awslocal secretsmanager get-secret-value \
		--secret-id 'poc-vpn/billing/stripe-webhook-secret' --query SecretString --output text |
		wc -l | tr -d ' ' | sed 's/^/webhook=/'"

# Closing a window and reopening it, on one node, live. The loop above proves a
# window is open; nothing there proves it can be *shut*, and a window that never
# ends is not a rotation — it is a second permanent credential.
#
# Ends where it started, so the file is idempotent: the last call restores the
# pair the entrypoint wrote. If this block dies halfway, `docker compose restart
# wireguard-eu` puts it back, because the entrypoint writes the same two lines.
ROTATION_NODE='eu'
ROTATION_PORT='21841'
_pid_before=$(node_httpd_pid "$ROTATION_NODE")
_current=$(node_credential "$ROTATION_NODE")
_previous=$(node_credential "$ROTATION_NODE" AWSPREVIOUS)

docker compose exec -T "wireguard-${ROTATION_NODE}" /rotate.sh "$_current" >/dev/null 2>&1

check_status "the ${ROTATION_NODE} control plane drops the retired value when the window closes" 401 \
	-u "${EXIT_NODE_API_USER}:${_previous}" \
	"http://127.0.0.1:${ROTATION_PORT}/cgi-bin/describe"

check_body "the ${ROTATION_NODE} control plane keeps serving the current value throughout" 'publicKey=' \
	-u "${EXIT_NODE_API_USER}:${_current}" \
	"http://127.0.0.1:${ROTATION_PORT}/cgi-bin/describe"

docker compose exec -T "wireguard-${ROTATION_NODE}" /rotate.sh "$_current" "$_previous" >/dev/null 2>&1

check_body "the ${ROTATION_NODE} control plane takes the retired value back when the window reopens" 'publicKey=' \
	-u "${EXIT_NODE_API_USER}:${_previous}" \
	"http://127.0.0.1:${ROTATION_PORT}/cgi-bin/describe"

# The claim itself. Rotating used to mean recreating the container, which drops
# the tunnel and every peer on it; busybox httpd re-reads its config on SIGHUP,
# so the same process served all four probes above. DEC-102.
if [ -n "$_pid_before" ] && [ "$_pid_before" = "$(node_httpd_pid "$ROTATION_NODE")" ]; then
	pass "the ${ROTATION_NODE} control plane served the whole rotation without restarting"
else
	fail "the ${ROTATION_NODE} control plane served the whole rotation without restarting" \
		"httpd was ${_pid_before} before and $(node_httpd_pid "$ROTATION_NODE") after"
fi

check_env_drift

printf '\n%s passed, %s failed\n\n' "$PASSED" "$FAILED"
[ "$FAILED" -eq 0 ] || exit 1
