#!/bin/sh
set -e

wg-quick up wg0

trap 'wg-quick down wg0; exit 0' TERM INT

sleep infinity &
wait $!
