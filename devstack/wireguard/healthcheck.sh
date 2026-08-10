#!/bin/sh
#
# Three probes, because each stays green while another is broken: a tunnel with a
# dead control plane still answers `wg show`, and a control plane that hands its
# public key to an anonymous caller is the failure DEC-073 exists to remove.
#
# The anonymous probe asserts the absence of the payload rather than a 401 status
# line, because the status text belongs to whatever serves the realm and the
# payload is what actually must not leak.
set -e

URL="http://127.0.0.1:${CONTROL_PORT:-51821}/cgi-bin/describe"

wg show wg0 >/dev/null

if wget -q -O - "$URL" 2>/dev/null | grep -q '^publicKey='; then
	printf 'the control plane served its public key to an anonymous caller\n' >&2
	exit 1
fi

credential=$(printf '%s:%s' "$CONTROL_USER" "$EXIT_NODE_API_TOKEN" | base64 | tr -d '\n')

wget -q -O - --header "Authorization: Basic ${credential}" "$URL" | grep -q '^publicKey='
