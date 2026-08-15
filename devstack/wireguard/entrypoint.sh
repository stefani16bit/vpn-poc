#!/bin/sh
set -e

CONTROL_PORT=${CONTROL_PORT:-51821}

: "${EXIT_NODE_API_TOKEN:?refusing to serve the control plane with no credential to check}"

# The same script an operator calls to rotate, so booting with a window open and
# rotating into one produce byte-identical config. A node started mid-rotation is
# the normal case, not a special one: whoever wrote the new secret to the vault
# may not have reached this machine yet.
/rotate.sh "$EXIT_NODE_API_TOKEN" ${EXIT_NODE_API_TOKEN_PREVIOUS:+"$EXIT_NODE_API_TOKEN_PREVIOUS"}

# The image carries /srv/control, because a real node has no repository to mount.
# The devstack mounts the same directory at /srv/control-src, and copying it over
# on boot is what makes an edited script reach the node on `restart` instead of
# on `build`. The mount being absent is what makes this a no-op in production.
#
# Copied rather than served in place: the execute bit travels with the host, and
# these files are 100644 in git. Served straight off the mount they run here,
# where Docker Desktop reports 0777, and answer 500 on a host that honours the
# mode it was given. DEC-089.
if [ -d /srv/control-src ]; then
	cp -R /srv/control-src/. /srv/control/
	chmod +x /srv/control/cgi-bin/*
fi

wg-quick up wg0

httpd -p "${CONTROL_PORT}" -h /srv/control -c /etc/httpd.conf -r 'poc-vpn exit node'

trap 'wg-quick down wg0; exit 0' TERM INT

sleep infinity &
wait $!
