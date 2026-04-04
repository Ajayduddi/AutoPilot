#!/bin/sh
set -eu

PORT="${PORT:-3000}"
HOST="${HOST:-0.0.0.0}"
FRONTEND_ORIGIN="${FRONTEND_ORIGIN:-http://localhost:${PORT}}"
FRONTEND_STATIC_DIR="${FRONTEND_STATIC_DIR:-/app/public}"

cd /app

echo "[start-all] Starting backend on ${HOST}:${PORT}"
echo "[start-all] FRONTEND_ORIGIN=${FRONTEND_ORIGIN}"
echo "[start-all] FRONTEND_STATIC_DIR=${FRONTEND_STATIC_DIR}"
exec bun /app/apps/backend/dist/index.js
