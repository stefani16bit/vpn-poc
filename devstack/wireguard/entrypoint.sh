#!/bin/sh
set -e

CONTROL_PORT=${CONTROL_PORT:-51821}

: "${EXIT_NODE_API_TOKEN:?refusing to serve the control plane with no credential to check}"

# Written outside -h so httpd can never serve the file that holds the credential.
printf '/:%s:%s\n' "$CONTROL_USER" "$EXIT_NODE_API_TOKEN" >/etc/httpd.conf
chmod 600 /etc/httpd.conf

wg-quick up wg0

httpd -p "${CONTROL_PORT}" -h /srv/control -c /etc/httpd.conf -r 'poc-vpn exit node'

trap 'wg-quick down wg0; exit 0' TERM INT

sleep infinity &
wait $!
