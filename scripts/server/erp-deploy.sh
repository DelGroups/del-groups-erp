#!/usr/bin/env bash
# Deploy a del-groups-erp source archive (tar.gz on stdin) on the Hetzner VPS.
#
# Installed as /usr/local/bin/del-groups-erp-deploy. GitHub Actions runs it as
# a *forced command*: its key in root's authorized_keys can execute only this
# script, and the archive arrives on stdin (`git archive HEAD | ssh ...`).
# The image is built from a staging copy first, so a failed build leaves the
# running container and /opt/del-groups-erp untouched.
set -euo pipefail

APP_DIR=/opt/del-groups-erp
PROJECT=del-groups-erp
CONTAINER=del-groups-erp-erp-1
COMPOSE=(docker compose -p "$PROJECT" --env-file .env.production -f docker-compose.prod.yml)
SCHEMA_CHECK_BLOCKING=0
# Docker build cache older than this is deleted before every build. Without it the
# cache fills the disk (27 GB of 38 GB on 2026-10-17) and the build fails with
# "no space left on device". Recent layers stay, so builds remain fast.
BUILD_CACHE_MAX_AGE=24h

prune_build_cache() {
    docker builder prune -f --filter "until=$BUILD_CACHE_MAX_AGE" >/dev/null 2>&1 || true
}

main() {
    exec 9>/run/lock/del-groups-erp-deploy.lock
    if ! flock -n 9; then
        echo "!! another ERP deploy is already running"
        exit 1
    fi

    staging=$(mktemp -d /tmp/del-groups-erp-deploy.XXXXXX)
    trap 'rm -rf "$staging"' EXIT

    echo "==> unpacking source"
    tar xzf - -C "$staging"
    if [ ! -f "$staging/docker-compose.prod.yml" ]; then
        echo "!! archive has no docker-compose.prod.yml"
        exit 1
    fi
    cp -p "$APP_DIR/.env.production" "$staging/.env.production"

    prune_build_cache

    echo "==> building image"
    (cd "$staging" && "${COMPOSE[@]}" build --quiet </dev/null)

    # Every table/RPC the code uses must exist in the live database (P0-2).
    # Report-only until the known gaps are fixed: set SCHEMA_CHECK_BLOCKING=1
    # to make missing objects (exit 1) stop the deploy. If the check cannot run
    # at all (exit 2, e.g. Supabase unreachable) it only warns.
    echo "==> checking database schema"
    local check=0
    docker run --rm -v "$staging":/app:ro -w /app node:22-alpine \
        node scripts/check-schema.mjs --env-file .env.production </dev/null || check=$?
    if [ "$check" -eq 1 ] && [ "$SCHEMA_CHECK_BLOCKING" = 1 ]; then
        echo "!! code references database objects that do not exist - deploy stopped, live site unchanged"
        exit 1
    elif [ "$check" -ne 0 ]; then
        echo "!! schema check reported problems (exit $check) - report-only, continuing"
    fi

    echo "==> switching source"
    find "$APP_DIR" -mindepth 1 -maxdepth 1 ! -name .env.production -exec rm -rf {} +
    rm "$staging/.env.production"
    cp -a "$staging/." "$APP_DIR/"

    echo "==> restarting container"
    cd "$APP_DIR"
    "${COMPOSE[@]}" up -d </dev/null

    echo "==> waiting for healthy"
    for _ in $(seq 1 45); do
        if [ "$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER")" = healthy ]; then
            docker image prune -f >/dev/null
            prune_build_cache
            echo "==> deploy ok"
            return 0
        fi
        sleep 2
    done

    echo "!! not healthy after 90s"
    docker logs --tail 40 "$CONTAINER"
    exit 1
}

main "$@"
