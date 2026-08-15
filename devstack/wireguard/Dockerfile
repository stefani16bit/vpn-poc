FROM alpine:3.21

RUN apk add --no-cache wireguard-tools iptables busybox-extras

# The node has no user directory; the shared token is the password and this is
# the name on the node's side of it. HttpExitNode holds the other side.
ENV CONTROL_USER=worker

COPY control /srv/control
COPY entrypoint.sh /entrypoint.sh
COPY healthcheck.sh /healthcheck.sh
COPY rotate.sh /rotate.sh

RUN chmod +x /srv/control/cgi-bin/* /entrypoint.sh /healthcheck.sh /rotate.sh

ENTRYPOINT ["/entrypoint.sh"]
