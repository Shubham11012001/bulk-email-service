# ==============================================================================
# Stage 1: Build TypeScript into JavaScript
# ==============================================================================
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Copy package manifests first to leverage Docker layer caching
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies needed for build)
RUN npm ci

# Copy source code, config, and static frontend assets
COPY tsconfig.json ./
COPY src/ ./src/
COPY public/ ./public/

# Compile TypeScript into dist/
RUN npm run build

# Prune devDependencies to keep the production runtime minimal
RUN npm prune --omit=dev


# ==============================================================================
# Stage 2: Minimal Production Runtime
# ==============================================================================
FROM node:20-bookworm-slim AS runner

WORKDIR /app

# Install curl (healthcheck), postgresql-client (pg_isready check), and dumb-init (signal handling)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    postgresql-client \
    dumb-init \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_URL=postgresql://postgres:postgres@postgres:5432/bulk_email_agent

# Copy built application and production dependencies from builder
COPY package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

# Copy the startup orchestration script
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Ensure attachments directory exists
RUN mkdir -p /app/data/attachments

# Volume mount point for uploaded attachments
VOLUME ["/app/data/attachments"]

# Expose web server port
EXPOSE 3000

# Container health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# Use dumb-init to properly handle PID 1 signals
ENTRYPOINT ["/usr/bin/dumb-init", "--", "./docker-entrypoint.sh"]
