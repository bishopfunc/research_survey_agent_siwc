#!/bin/bash
# Container entrypoint (design 0032): the gate and the PoC server share this container and its network, so the gate reaches
# the app on 127.0.0.1:8788 and the token port 127.0.0.1:8090 reaches only processes here. If either stops, both stop and
# Docker restarts the container. The token key goes to the gate only, never into the app's (and Codex's) environment.
node_modules/.bin/tsx scripts/vps-gate.ts & gate=$!
env -u GATE_TOKEN_KEY node_modules/.bin/tsx scripts/poc-server.ts & app=$!
trap 'kill -TERM "$gate" "$app" 2>/dev/null' TERM INT
wait -n
kill -TERM "$gate" "$app" 2>/dev/null
wait
exit 1
