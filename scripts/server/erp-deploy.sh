#!/usr/bin/env bash
# Deploy a del-groups-erp source archive (tar.gz on stdin) on the Hetzner VPS.
#
# Installed as /usr/local/bin/del-groups-erp-deploy. GitHub Actions runs it as
# a *forced command*: its key in root's authorized_keys can execute only this
# script, and the archive arrives on stdin (`git archive HEAD | ssh ...`).
# The image is built from a staging copy first, so a failed build leaves the
# running container and /opt/del-groups-erp untouched.
#
# SAAS-1: after production is healthy, the trial stack (docker-compose.saas.yml: the
# multi-tenant ERP and the control panel) is built and restarted too, but only when BOTH
# /opt/del-groups-erp/.env.saas and .env.control-panel exist. A failure there prints a
# warning and never fails or rolls back the production deploy that already passed.
set -euo pipefail

# The two overrides exist only for tests/erpDeploy.test.mjs (sshd passes no env to the forced command).
APP_DIR=${ERP_DEPLOY_APP_DIR:-/opt/del-groups-erp}
LOCK_FILE=${ERP_DEPLOY_LOCK:-/run/lock/del-groups-erp-deploy.lock}
PROJECT=del-groups-erp
CONTAINER=del-groups-erp-erp-1
COMPOSE=(docker compose -p "$PROJECT" --env-file .env.production -f docker-compose.prod.yml)
SCHEMA_CHECK_BLOCKING=0

# Trial stack (off unless both env files exist on the server).
SAAS_PROJECT=del-groups-saas
SAAS_ENV="$APP_DIR/.env.saas"
CP_ENV="$APP_DIR/.env.control-panel"
SAAS_CONTAINERS=(del-groups-saas-erp-saas-1 del-groups-saas-control-panel-1)
# The control panel's build args are read from .env.control-panel, which comes last.
SAAS_COMPOSE=(docker compose -p "$SAAS_PROJECT" --env-file "$SAAS_ENV" --env-file "$CP_ENV" -f docker-compose.saas.yml)
# Files in $APP_DIR that a deploy keeps (everything else is replaced by the new source).
KEEP=(.env.production .env.saas .env.control-panel)

main() {
    exec 9>"$LOCK_FILE"
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
    local keep_args=()
    for f in "${KEEP[@]}"; do keep_args+=(! -name "$f"); done
    find "$APP_DIR" -mindepth 1 -maxdepth 1 "${keep_args[@]}" -exec rm -rf {} +
    rm "$staging/.env.production"
    cp -a "$staging/." "$APP_DIR/"

    echo "==> restarting container"
    cd "$APP_DIR"
    "${COMPOSE[@]}" up -d </dev/null

    echo "==> waiting for healthy"
    local healthy=0
    for _ in $(seq 1 45); do
        if [ "$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER")" = healthy ]; then
            healthy=1
            break
        fi
        sleep 2
    done
    if [ "$healthy" != 1 ]; then
        echo "!! not healthy after 90s"
        docker logs --tail 40 "$CONTAINER"
        exit 1
    fi
    docker image prune -f >/dev/null
    echo "==> deploy ok"

    # Production is live and healthy from here on: nothing below may fail this deploy.
    deploy_saas || echo "!! WARNING: trial stack (del-groups-saas) not updated - production deploy is fine; see the lines above"

    # The server disk filled with build cache once (2026-10-17): drop layers older than 3 days.
    docker builder prune -af --filter until=72h >/dev/null 2>&1 || echo "!! WARNING: docker builder prune failed"
    return 0
}

# Builds the trial stack from the staging copy (a failed build leaves its running containers as
# they are), then restarts it from $APP_DIR and waits for both containers. Runs inside `||`, where
# bash ignores `set -e`, so every step checks its own result.
deploy_saas() {
    if [ ! -f "$SAAS_ENV" ] || [ ! -f "$CP_ENV" ]; then
        echo "==> trial stack: off (.env.saas and .env.control-panel not both present)"
        return 0
    fi
    if [ ! -f "$staging/docker-compose.saas.yml" ]; then
        echo "!! trial stack: archive has no docker-compose.saas.yml"
        return 1
    fi

    echo "==> trial stack: building images"
    (cd "$staging" && "${SAAS_COMPOSE[@]}" build --quiet </dev/null) || { echo "!! trial stack: build failed - its running containers are unchanged"; return 1; }

    echo "==> trial stack: restarting"
    (cd "$APP_DIR" && "${SAAS_COMPOSE[@]}" up -d </dev/null) || { echo "!! trial stack: up failed"; return 1; }

    echo "==> trial stack: waiting for healthy"
    local c status
    for c in "${SAAS_CONTAINERS[@]}"; do
        status=""
        for _ in $(seq 1 45); do
            status=$(docker inspect -f '{{.State.Health.Status}}' "$c" 2>/dev/null || true)
            [ "$status" = healthy ] && break
            sleep 2
        done
        if [ "$status" != healthy ]; then
            echo "!! trial stack: $c not healthy after 90s (status: ${status:-missing})"
            docker logs --tail 40 "$c" 2>&1 || true
            return 1
        fi
    done
    echo "==> trial stack ok"
    return 0
}

main "$@"
