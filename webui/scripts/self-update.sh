#!/usr/bin/env bash
#
# Applies a repository update and restarts the service.
#
# Launched by the app through `systemd-run --user`, which places it in its own
# transient unit — outside our service's cgroup. That is what keeps it alive
# through the `systemctl restart` at the end; a plain child would be killed
# together with the process that spawned it.
#
# On any failure it exits WITHOUT restarting, leaving the running (old) service
# untouched.
#
set -euo pipefail

WEBUI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$WEBUI_DIR/.." && pwd)"
SERVICE="${SHX_SERVICE_NAME:-strix-halo-webui.service}"
LOG="${SHX_UPDATE_LOG:-/dev/stdout}"

exec >>"$LOG" 2>&1

step() { printf '\n=== %s ===\n' "$*"; }
fail() { printf '\nFEHLGESCHLAGEN: %s\n' "$*"; printf 'Der laufende Dienst bleibt unveraendert.\n'; exit 1; }

printf 'Self-Update gestartet: %s\n' "$(date -Is)"
printf 'Repository: %s\n' "$REPO_DIR"

step "Arbeitsverzeichnis pruefen"
if [[ -n "$(git -C "$REPO_DIR" status --porcelain)" ]]; then
  git -C "$REPO_DIR" status --short
  fail "Es gibt lokale Aenderungen. Committe oder verwirf sie zuerst."
fi

BEFORE="$(git -C "$REPO_DIR" rev-parse HEAD)"
printf 'Aktueller Stand: %s\n' "$BEFORE"

step "git pull --ff-only"
git -C "$REPO_DIR" pull --ff-only || fail "git pull schlug fehl (kein Fast-Forward moeglich?)"

AFTER="$(git -C "$REPO_DIR" rev-parse HEAD)"
printf 'Neuer Stand: %s\n' "$AFTER"

if [[ "$BEFORE" == "$AFTER" ]]; then
  printf 'Nichts zu tun, der Stand war bereits aktuell.\n'
  exit 0
fi

cd "$WEBUI_DIR"

if [[ "${SHX_SKIP_INSTALL:-0}" != "1" ]]; then
  step "npm ci"
  npm ci || fail "npm ci schlug fehl"
else
  printf '\n(npm ci uebersprungen, keine Abhaengigkeiten geaendert)\n'
fi

if [[ "${SHX_SKIP_BUILD:-0}" != "1" ]]; then
  step "npm run build"
  npm run build || fail "Der Frontend-Build schlug fehl"
else
  printf '\n(Build uebersprungen, kein Frontend-Code geaendert)\n'
fi

step "Dienst neu starten"
systemctl --user restart "$SERVICE" || fail "Neustart des Dienstes schlug fehl"

printf '\nUpdate abgeschlossen: %s -> %s\n' "${BEFORE:0:7}" "${AFTER:0:7}"
printf 'Fertig: %s\n' "$(date -Is)"
