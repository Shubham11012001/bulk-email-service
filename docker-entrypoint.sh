#!/bin/bash
set -e

# If custom command arguments are passed, execute them directly
if [ "$#" -gt 0 ]; then
  exec "$@"
fi

echo "=========================================================="
echo " 🚀 Starting Bulk Email Agent Services"
echo "=========================================================="

# Ensure attachments directory exists
mkdir -p /app/data/attachments

# 1. Wait for PostgreSQL to become reachable
echo "==> Step 1: Waiting for PostgreSQL connection..."
MAX_RETRIES=30
RETRY_COUNT=0

until pg_isready -d "$DATABASE_URL" > /dev/null 2>&1; do
  RETRY_COUNT=$((RETRY_COUNT+1))
  if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
    echo "❌ Error: Timed out waiting for PostgreSQL to be ready at $DATABASE_URL. Exiting."
    exit 1
  fi
  echo "    Waiting for DB ($RETRY_COUNT/$MAX_RETRIES)..."
  sleep 1
done
echo "✅ Database connection established!"

# 2. Run Database Migrations
echo "==> Step 2: Executing database migrations..."
node dist/db/migrate.js
echo "✅ Migrations completed successfully!"

# 3. Graceful shutdown handler
cleanup() {
  echo ""
  echo "==> Received shutdown signal. Stopping services..."
  kill -TERM "$WORKER_PID" "$SERVER_PID" 2>/dev/null
  wait "$WORKER_PID" "$SERVER_PID" 2>/dev/null
  echo "✅ All services stopped cleanly."
  exit 0
}
trap cleanup SIGTERM SIGINT SIGHUP

# 4. Start Background Email Worker Queue
echo "==> Step 3: Starting background email worker queue..."
node dist/worker.js &
WORKER_PID=$!
echo "    Worker running (PID: $WORKER_PID)"

# 5. Start Fastify Web Server
echo "==> Step 4: Starting Fastify server on port ${PORT:-3000}..."
node dist/server.js &
SERVER_PID=$!
echo "    Server running (PID: $SERVER_PID)"

echo "=========================================================="
echo " Application is online at http://0.0.0.0:${PORT:-3000}"
echo "=========================================================="

# Wait for either process to exit. If one crashes, the container stops
wait -n "$SERVER_PID" "$WORKER_PID"
