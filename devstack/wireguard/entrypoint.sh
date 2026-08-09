#!/bin/sh
set -e

CONTROL_PORT=${CONTROL_PORT:-51821}

wg-quick up wg0

httpd -p "${CONTROL_PORT}" -h /srv/control

trap 'wg-quick down wg0; exit 0' TERM INT

sleep infinity &
wait $!
