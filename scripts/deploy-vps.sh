#!/usr/bin/env bash
# Deploys a committed revision to the self-hosted VPS (design 0029), or rolls back to the previous one.
#   scripts/deploy-vps.sh [rev]      build rev (default HEAD) on the VPS and switch to it
#   scripts/deploy-vps.sh --rollback switch back to the image that ran before the last deploy
# Only committed files are sent (git archive); the VPS builds with its own Docker layer cache.
set -euo pipefail
HOST="${VPS_HOST:-sakura-vps}"
PUBLIC_HOST="${VPS_PUBLIC_HOST:-tk2-233-26242.vs.sakura.ne.jp}"
KEEP=3
remote() { ssh -x -o BatchMode=yes "$HOST" "$@"; }

switch_to() { # $1 image to run; keeps the one it replaces as PREVIOUS_IMAGE
  remote "set -e; cd ~/apps/survey
    current=\$(sed -n 's/^APP_IMAGE=//p' .env 2>/dev/null || true)
    printf 'APP_IMAGE=%s\nPREVIOUS_IMAGE=%s\nPUBLIC_HOST=%s\n' '$1' \"\$current\" '$PUBLIC_HOST' > .env.next && mv .env.next .env
    docker compose up -d --remove-orphans"
  for attempt in $(seq 1 30); do
    if remote "curl -fsS --max-time 5 --resolve $PUBLIC_HOST:443:127.0.0.1 https://$PUBLIC_HOST/auth/health" >/dev/null 2>&1; then echo "up: $1"; return 0; fi
    sleep 2
  done
  echo "health check failed: $1 (scripts/deploy-vps.sh --rollback to go back)" >&2; return 1
}

if [ "${1:-}" = "--rollback" ]; then
  previous=$(remote "sed -n 's/^PREVIOUS_IMAGE=//p' ~/apps/survey/.env")
  [ -n "$previous" ] || { echo "no previous image" >&2; exit 1; }
  switch_to "$previous"; exit
fi

sha=$(git rev-parse --short=12 "${1:-HEAD}^{commit}")
image="survey-app:$sha"
remote "mkdir -p ~/apps/survey"
git archive --format=tar "$sha" deploy/vps | remote "tar -x --strip-components=2 -C ~/apps/survey"
git archive --format=tar "$sha" | remote "docker build -q -t $image -f deploy/vps/Dockerfile -" >/dev/null
switch_to "$image"
# Keep the newest images; the running and previous ones are never removed.
remote "cd ~/apps/survey; keep=\$(sed -n 's/^\(APP\|PREVIOUS\)_IMAGE=//p' .env)
  docker image ls survey-app --format '{{.Repository}}:{{.Tag}}' | tail -n +$((KEEP + 1)) | grep -vxF \"\$keep\" | xargs -r docker image rm >/dev/null || true"
