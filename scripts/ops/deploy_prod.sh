#!/usr/bin/env bash
set -Eeuo pipefail

# Safe production deploy helper for Alphenzi.
# - Pulls latest code (fast-forward only)
# - Builds web/api images first (prevents runtime 502 build loops)
# - Starts stack
# - Verifies health endpoint
#
# Usage:
#   cd /opt/lnz
#   bash scripts/ops/deploy_prod.sh
#
# Optional env overrides:
#   DEPLOY_BRANCH=main
#   ENV_FILE=.env
#   COMPOSE_FILE=docker-compose.prod.yml
#   SKIP_GIT_PULL=1

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
ENV_FILE="${ENV_FILE:-.env}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: missing env file '$ENV_FILE' in $ROOT_DIR"
  exit 1
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Error: missing compose file '$COMPOSE_FILE' in $ROOT_DIR"
  exit 1
fi

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

if [[ "${SKIP_GIT_PULL:-0}" != "1" ]] && command -v git >/dev/null 2>&1 && [[ -d .git ]]; then
  echo "[1/6] Syncing code from origin/${DEPLOY_BRANCH}..."
  git fetch origin "$DEPLOY_BRANCH"
  git checkout "$DEPLOY_BRANCH"
  git pull --ff-only origin "$DEPLOY_BRANCH"
else
  echo "[1/6] Skipping git sync."
fi

echo "[2/6] Building API and Web images first..."
compose build api web

echo "[3/6] Starting production stack..."
compose up -d

echo "[4/6] Current container status:"
compose ps

DOMAIN="$(grep '^LNZ_DOMAIN=' "$ENV_FILE" | cut -d= -f2- | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' || true)"
if [[ -n "$DOMAIN" ]]; then
  HEALTH_URL="https://${DOMAIN}/api/v1/health"
else
  HEALTH_URL="http://localhost/api/v1/health"
fi

echo "[5/6] Waiting for health check: ${HEALTH_URL}"
HEALTH_OK=0
for _ in {1..30}; do
  if RESPONSE="$(curl -fsS "$HEALTH_URL" 2>/dev/null)"; then
    echo "Health response: ${RESPONSE}"
    HEALTH_OK=1
    break
  fi
  sleep 2
done

if [[ "$HEALTH_OK" -ne 1 ]]; then
  echo "Health check did not pass in time. Recent logs:"
  compose logs web --tail 80 || true
  compose logs api --tail 80 || true
  compose logs caddy --tail 80 || true
  exit 1
fi

echo "[6/6] Deploy completed successfully."
