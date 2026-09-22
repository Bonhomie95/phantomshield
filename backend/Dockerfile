# Build context MUST be the repo root:  docker build -f backend/Dockerfile .
# The backend depends on the workspace package @phantomshield/shared and the
# lockfile lives only at the repo root, so a backend-only context cannot resolve
# dependencies.

# ─── Builder ─────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Manifests first for a cached dependency layer.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY backend/package.json backend/

# Full install (dev deps needed to compile TS) across the two relevant workspaces.
RUN npm ci --workspace @phantomshield/shared --workspace phantomshield-backend --include-workspace-root

# Sources.
COPY packages/shared packages/shared
COPY backend backend

# Build shared first (backend imports its compiled output), then the backend.
RUN npm run build --workspace @phantomshield/shared \
 && npm run build --workspace phantomshield-backend

# ─── Production deps ─────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY backend/package.json backend/
RUN npm ci --omit=dev --workspace @phantomshield/shared --workspace phantomshield-backend --include-workspace-root \
 && npm cache clean --force

# ─── Runtime ─────────────────────────────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

# Prod node_modules (hoisted at root) + compiled shared package it links to.
COPY --from=deps    /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/dist         packages/shared/dist
COPY --from=builder /app/packages/shared/package.json  packages/shared/package.json
COPY --from=builder /app/backend/dist                  backend/dist
COPY --from=builder /app/backend/package.json          backend/package.json

# Drop root privileges — the base image ships an unprivileged `node` user.
USER node

EXPOSE 3002

# Probe READINESS, not liveness. /health returns 200 as long as the event loop
# turns, so an instance with a dead Mongo or Redis would stay "healthy" and keep
# receiving traffic forever. /ready returns 503 when a dependency is down.
#
# retries=5 at 30s means ~2.5 minutes of sustained failure before the container
# is marked unhealthy — long enough to ride out a transient dependency blip
# (Redis reconnects with backoff, Mongo auto-reconnects) without flapping.
#
# Orchestrators should map: liveness -> /health, readiness -> /ready.
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=5 \
  CMD node -e "require('http').get('http://127.0.0.1:3002/ready',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "backend/dist/index.js"]
