# syntax=docker/dockerfile:1
# Self-hosted VPS image (design 0032): the PoC server, the SIWC gate and the Codex CLI. Built on the VPS from `git archive`.
FROM node:24-bookworm-slim
ARG CODEX_VERSION=0.162.1
# The real Codex goes to /usr/local/bin; /opt/survey/bin/codex comes first in PATH and runs it on the gate's ChatGPT token.
# Codex (Rust) verifies TLS with the system certificates, which the slim image does not have; Node carries its own.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* \
 && npm install -g @openai/codex@${CODEX_VERSION} && npm cache clean --force \
 && mkdir -p /app /home/node/.codex /home/node/.codex-siwc /opt/survey/bin \
 && chown node:node /app /home/node/.codex /home/node/.codex-siwc \
 && printf '#!/bin/sh\nexec /app/node_modules/.bin/tsx /app/scripts/codex-siwc.ts "$@"\n' > /opt/survey/bin/codex && chmod 755 /opt/survey/bin/codex
USER node
WORKDIR /app
# Dependencies first, so a change that keeps package-lock.json reuses this layer.
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node apps/web/package.json apps/web/
COPY --chown=node:node packages/agent/package.json packages/agent/
COPY --chown=node:node packages/domain/package.json packages/domain/
COPY --chown=node:node packages/storage/package.json packages/storage/
RUN --mount=type=cache,target=/home/node/.npm,uid=1000,gid=1000 npm ci --no-audit --no-fund
COPY --chown=node:node . .
RUN mkdir -p .poc .gate && node scripts/codex-catalog.mjs ${CODEX_VERSION} > /home/node/codex-catalog.json
ENV HOME=/home/node PATH=/opt/survey/bin:$PATH REAL_CODEX=/usr/local/bin/codex CODEX_CATALOG=/home/node/codex-catalog.json
CMD ["node_modules/.bin/tsx", "scripts/poc-server.ts"]
