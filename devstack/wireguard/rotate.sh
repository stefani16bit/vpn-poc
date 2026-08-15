#!/bin/sh
#
# Makes the control plane accept exactly the credentials named here, and nothing
# else. One argument closes a window; two open one.
#
# A rotation is two calls. `rotate.sh NEW OLD` opens the window, so both values
# work while whatever holds the other side catches up; `rotate.sh NEW` closes it,
# and the retired value stops working from the next request on. Neither call
# restarts anything — busybox httpd re-reads /etc/httpd.conf on SIGHUP, so the
# tunnel never drops and no peer is lost. DEC-102.
set -eu

usage() {
	printf 'usage: %s <current> [previous]\n' "$0" >&2
	exit 64
}

# The two shapes busybox reads as something other than a password, both of which
# produce a node that boots and then refuses everyone with a 401 that points
# nowhere. A value starting with $<digit> is taken for a crypt hash and compared
# against an encryption of what the caller sent; a colon splits the config line,
# so everything after it silently stops being part of the secret.
reject_unusable() {
	case "$1" in
	'') printf 'refusing to write an empty credential\n' >&2; exit 65 ;;
	*:*) printf 'refusing a credential containing ":", which splits the config field\n' >&2; exit 65 ;;
	'$'[0-9]*)
		printf 'refusing a credential starting with $<digit>, which busybox reads as a crypt hash\n' >&2
		exit 65
		;;
	esac
}

[ $# -ge 1 ] && [ $# -le 2 ] || usage

reject_unusable "$1"
[ $# -eq 2 ] && reject_unusable "$2"

# Written outside -h so httpd can never serve the file that holds the credential.
# Both lines carry the same path, which busybox keeps as two entries and tries in
# turn: a mismatch on the first falls through to the second, and only an
# exhausted list is a 401.
{
	printf '/:%s:%s\n' "$CONTROL_USER" "$1"
	if [ $# -eq 2 ]; then
		printf '/:%s:%s\n' "$CONTROL_USER" "$2"
	fi
} >/etc/httpd.conf
chmod 600 /etc/httpd.conf

# Absent at boot, when the entrypoint calls this before starting the server. The
# file is already in place by then, so there is nothing to reload.
if pidof httpd >/dev/null 2>&1; then
	killall -HUP httpd
fi
