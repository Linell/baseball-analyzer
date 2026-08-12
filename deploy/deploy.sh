#!/usr/bin/env bash
# Deploy to the droplet: push the compose file, pull the image, restart.
# Usage: deploy/deploy.sh [tag]   — tag defaults to latest; pass a commit SHA
# to roll back to that build.
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
    echo "deploy/.env is missing; copy .env.example and fill it in" >&2
    exit 1
fi
# shellcheck source=.env.example
source .env
: "${DEPLOY_HOST:?DEPLOY_HOST is required in deploy/.env}"
: "${DEPLOY_SSH_KEY:?DEPLOY_SSH_KEY is required in deploy/.env}"

TAG="${1:-latest}"
SSH=(ssh -i "${DEPLOY_SSH_KEY/#\~/$HOME}" "$DEPLOY_HOST")

# The disk is shared with two other apps; refuse to add image layers when low.
free_kb=$("${SSH[@]}" "df -k --output=avail / | tail -1" | tr -d '[:space:]')
if (( free_kb < 5 * 1024 * 1024 )); then
    echo "abort: less than 5 GB free on the droplet ($((free_kb / 1024)) MB)" >&2
    exit 1
fi

scp -i "${DEPLOY_SSH_KEY/#\~/$HOME}" compose.yml "$DEPLOY_HOST":/srv/baseball-analyzer/compose.yml

"${SSH[@]}" "set -e
    cd /srv/baseball-analyzer
    TAG=$TAG docker compose --env-file /etc/baseball-analyzer/env pull
    TAG=$TAG docker compose --env-file /etc/baseball-analyzer/env up -d
    docker image prune -f"

echo "deployed tag $TAG"
