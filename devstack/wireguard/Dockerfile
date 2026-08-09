FROM alpine:3.21

RUN apk add --no-cache wireguard-tools iptables busybox-extras

COPY control /srv/control
COPY entrypoint.sh /entrypoint.sh

RUN chmod +x /srv/control/cgi-bin/* /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
