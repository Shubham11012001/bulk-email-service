# ===================================================
# Stage 1: Build TypeScript and compile native addons
# ===================================================
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install native dependencies required for better-sqlite3 compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package manifests first to leverage Docker layer caching
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies needed for build)
RUN npm ci

# Copy source code and configs
COPY tsconfig.json ./
COPY src/ ./src/
COPY public/ ./public/

# Compile TypeScript into dist/
RUN npm run build

# Remove development dependencies to keep production node_modules minimal
RUN npm prune --omit=dev

# ===================================================
# Stage 2: Minimal Production Runtime
# ===================================================
FROM node:20-bookworm-slim AS runner

WORKDIR /app

# Install curl for container health check
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/app/data/email-agent.db

# Copy package.json and pre-compiled node_modules from builder
COPY package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

# Copy entrypoint script
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Create persistent data volume directory
RUN mkdir -p /app/data

EXPOSE 3000

# Mountable volume for SQLite database & uploaded attachments
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
