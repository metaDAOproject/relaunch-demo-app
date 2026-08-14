#!/usr/bin/env bash
# Relaunch demo — single entrypoint (standalone copy).
#
#   ./run.sh
#
# Boots a surfpool fork of mainnet (deploying relaunch + futarchy via the
# relaunch-demo runbook), bootstraps a live relaunch for the configured
# target token, and serves the UI. Ctrl-C tears everything down; re-running
# the script is the "reset demo" button.
#
# Program binaries live in ./programs; the SDK comes from the futarchy
# programs repo checkout, pinned by absolute path in both package.json
# files. After rebuilding there, copy fresh .so files into ./programs, and
# run `yarn install --force` here and in ui/ to pick up a new SDK build.
#
# Env knobs (all optional): TARGET_MINT, TARGET_POOL, TOKEN_NAME,
# TOKEN_SYMBOL, DEPOSIT_WINDOW_SECONDS, GRACE_SECONDS, THRESHOLD_BPS, UI_PORT.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

UI_PORT="${UI_PORT:-5173}"
RPC_URL="http://127.0.0.1:8899"
LOG_DIR="$ROOT/.surfpool"
mkdir -p "$LOG_DIR"

# ---------------------------------------------------------------- preflight
command -v surfpool >/dev/null 2>&1 || {
  echo "surfpool not found on PATH — install it first (https://surfpool.run)"
  exit 1
}
[[ -f programs/relaunch.so && -f programs/futarchy.so ]] || {
  echo "program binaries missing under ./programs — copy relaunch.so + futarchy.so"
  echo "from the programs repo's target/deploy (rebuild there with ./rebuild.sh first)"
  exit 1
}
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
[[ -n "${SURFPOOL_DATASOURCE_RPC_URL:-}" ]] || {
  echo "SURFPOOL_DATASOURCE_RPC_URL is not set — put a mainnet RPC URL in .env"
  exit 1
}

if [[ ! -d node_modules ]]; then
  echo "installing bootstrap dependencies (first run)…"
  yarn install --silent
fi
if [[ ! -d ui/node_modules ]]; then
  echo "installing UI dependencies (first run)…"
  (cd ui && yarn install --silent)
fi

# Anything already answering on 8899 would swallow the fork, and a stale
# vite would hold the UI port.
lsof -ti tcp:8899 | xargs kill -9 2>/dev/null || true
lsof -ti tcp:"$UI_PORT" | xargs kill -9 2>/dev/null || true

# ---------------------------------------------------------------- teardown
SURF_PID=""
VITE_PID=""
cleanup() {
  echo
  echo "shutting down…"
  [[ -n "$VITE_PID" ]] && kill "$VITE_PID" 2>/dev/null || true
  [[ -n "$SURF_PID" ]] && kill "$SURF_PID" 2>/dev/null || true
  pkill -f "surfpool start" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------- surfpool
echo "starting surfpool (logs: .surfpool/relaunch-demo.log)…"
surfpool start -r relaunch-demo --no-tui \
  >"$LOG_DIR/relaunch-demo.log" 2>&1 &
SURF_PID=$!

echo -n "waiting for the fork and the relaunch program"
RELAUNCH_PROGRAM="vaMpdXN2P3Z5v8y6GtAU5NzCUjxtphnRVpvqu37Spik"
for i in $(seq 1 90); do
  if ! kill -0 "$SURF_PID" 2>/dev/null; then
    echo
    echo "surfpool exited early — see .surfpool/relaunch-demo.log"
    exit 1
  fi
  RESULT=$(curl -s -X POST -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getAccountInfo","params":["'"$RELAUNCH_PROGRAM"'",{"encoding":"base64","dataSlice":{"offset":0,"length":0}}]}' \
    "$RPC_URL" 2>/dev/null || true)
  if grep -q '"executable":true' <<<"$RESULT"; then
    echo " ✓"
    break
  fi
  if [[ $i == 90 ]]; then
    echo
    echo "relaunch program never deployed — see .surfpool/relaunch-demo.log"
    exit 1
  fi
  echo -n "."
  sleep 1
done

# ---------------------------------------------------------------- bootstrap
echo
yarn --silent tsx bootstrap/bootstrap.ts

# ---------------------------------------------------------------- UI
echo
echo "starting the UI (logs: .surfpool/relaunch-demo-ui.log)…"
(cd ui && exec node_modules/.bin/vite --port "$UI_PORT" --strictPort) \
  >"$LOG_DIR/relaunch-demo-ui.log" 2>&1 &
VITE_PID=$!

for i in $(seq 1 30); do
  if curl -sf "http://localhost:$UI_PORT" >/dev/null 2>&1; then
    break
  fi
  if [[ $i == 30 ]]; then
    echo "vite did not come up — see .surfpool/relaunch-demo-ui.log"
    exit 1
  fi
  sleep 1
done

echo
echo "=== relaunch demo running — http://localhost:$UI_PORT (Ctrl-C stops everything) ==="
command -v open >/dev/null 2>&1 && open "http://localhost:$UI_PORT"

wait "$SURF_PID"
