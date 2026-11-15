# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1 - build the React client
# ---------------------------------------------------------------------------
FROM node:20-alpine AS frontend-builder

WORKDIR /app/client

# Install dependencies first so this layer is cached until a lockfile changes.
COPY client/package.json client/package-lock.json ./
RUN npm ci --no-audit --no-fund

# Build the static bundle consumed by server/index.js.
COPY client/ ./
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2 - runtime image
# ---------------------------------------------------------------------------
FROM node:20-alpine AS production

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

# Runtime dependencies only (express, dotenv).
COPY --chown=node:node server/package.json server/package-lock.json ./server/
RUN cd server \
 && npm ci --omit=dev --no-audit --no-fund \
 && npm cache clean --force

# `--chown` avoids a final `chown -R`, which would duplicate every file
# (including node_modules) in an extra layer.
COPY --chown=node:node server/ ./server/

# server/index.js resolves the frontend as path.resolve(__dirname, '..', 'client', 'dist'),
# i.e. /app/client/dist, so the layout must match the repository.
COPY --from=frontend-builder --chown=node:node /app/client/dist ./client/dist

# The official node image ships an unprivileged `node` user (uid 1000).
# The process never writes to disk, so read-only ownership is enough.
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
