DEV := sh devstack/dev.sh

.PHONY: up down reset reset-registry reload logs ps pull check

# Every target is a one-line shim on purpose. make is absent from a default
# Windows install, so the logic lives in devstack/dev.sh and make stays an
# alias rather than a prerequisite for bringing the stack up.
up:             ; @$(DEV) up
down:           ; @$(DEV) down
reset:          ; @$(DEV) reset
reset-registry: ; @$(DEV) reset-registry
ps:             ; @$(DEV) ps
pull:           ; @$(DEV) pull
check:          ; @$(DEV) check
reload:         ; @$(DEV) reload $(s)
logs:           ; @$(DEV) logs $(s)
