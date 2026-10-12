# syntax=docker/dockerfile:1
# Self-hosted VPS image (design 0029): the PoC server, the SIWC gate and the Codex CLI. Built on the VPS from `git archive`.
FROM node:24-bookworm-slim
RUN npm install -g @openai/codex@0.162.1 && npm cache clean --force \
 && mkdir -p /app /home/node/.codex && chown node:node /app /home/node/.codex
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
RUN mkdir -p .poc
ENV HOME=/home/node
CMD ["node_modules/.bin/tsx", "scripts/poc-server.ts"]
