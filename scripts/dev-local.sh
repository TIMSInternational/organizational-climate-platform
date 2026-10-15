#!/usr/bin/env bash
# Start the climate API, tracking API, and frontend as one local stack.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
LOG_DIR=${CLIMATE_DEV_LOG_DIR:-/tmp/climate-dev}
mkdir -p "$LOG_DIR"
for port in 5080 5091 5173; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is already in use. Stop that development server before starting this stack." >&2
    exit 1
  fi
done
pids=()
cleanup() {
  trap - EXIT INT TERM
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait || true
}
trap cleanup EXIT INT TERM
cd "$ROOT"
Logging__LogLevel__Default=Warning dotnet run --project src/ClimateProject.Api >"$LOG_DIR/api.log" 2>&1 &
pids+=("$!")
Logging__LogLevel__Default=Warning dotnet run --project services/tracking-api/src/ClimateTracking.Api >"$LOG_DIR/tracking.log" 2>&1 &
pids+=("$!")
(cd web && VITE_API_BASE_URL=http://127.0.0.1:5080 VITE_TRACKING_API_BASE_URL=http://localhost:5091 exec node node_modules/vite/bin/vite.js --host localhost --port 5173 --strictPort) >"$LOG_DIR/web.log" 2>&1 &
pids+=("$!")
for attempt in {1..90}; do
  for pid in "${pids[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "A development service exited. Check $LOG_DIR/{api,tracking,web}.log" >&2
      exit 1
    fi
  done
  if curl -fsS http://localhost:5080/ready >/dev/null 2>&1 &&
     curl -fsS http://localhost:5091/health >/dev/null 2>&1 &&
     curl -fsS http://localhost:5173/ >/dev/null 2>&1; then
    echo "Local application: http://localhost:5173"
    echo "Climate API: 5080 · Tracking API: 5091 · Logs: $LOG_DIR"
    echo "Keep this terminal open. Ctrl+C stops the stack."
    wait
    exit 0
  fi
  sleep 1
done
echo "Startup did not become healthy. Check $LOG_DIR/{api,tracking,web}.log" >&2
exit 1
