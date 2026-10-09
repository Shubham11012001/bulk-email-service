#!/bin/sh
set -e

# If arguments are passed, execute them directly
if [ "$#" -gt 0 ]; then
  exec "$@"
fi

echo "================================================"
echo " Starting Bulk Email Agent Container"
echo "================================================"

# Ensure data directory and attachments subfolder exist
mkdir -p /app/data/attachments

# 1. Run database migrations
echo "==> Running SQLite database migrations..."
node dist/db/migrate.js

# 2. Start the background email worker queue
echo "==> Starting background email worker queue..."
node dist/worker.js &
WORKER_PID=$!

# Trap termination signals to gracefully stop worker
trap "echo '==> Stopping email worker...'; kill $WORKER_PID 2>/dev/null; exit 0" SIGTERM SIGINT

# 3. Start the Fastify web server (foreground process)
echo "==> Starting Fastify server on port ${PORT:-3000}..."
exec node dist/server.js
