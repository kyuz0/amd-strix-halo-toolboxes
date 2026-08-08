#!/usr/bin/env bash
#
# Installs the Strix Halo WebUI as a systemd --user service.
#
# Deliberately runs as the normal user, never as root: podman here is rootless,
# and containers created by root would be invisible to (and unmanageable from)
# the user's session.
#
set -euo pipefail

WEBUI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="strix-halo-webui"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
CONFIG_DIR="${SHX_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/strix-halo-webui}"
STATE_DIR="${SHX_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/strix-halo-webui}"

PORT=8420
BIND="0.0.0.0"
MODELS_DIR="$HOME/models"
OPEN_FIREWALL=0
START=1
ASSUME_YES=0

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
ok()    { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn()  { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()   { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

  --port PORT           Port des Webinterfaces (Default: $PORT)
  --bind ADDR           Bind-Adresse (Default: $BIND, 127.0.0.1 fuer Reverse-Proxy)
  --models-dir DIR      Modellverzeichnis (Default: $MODELS_DIR)
  --open-firewall       firewall-cmd fuer den Port ausfuehren (fragt nach sudo)
  --no-start            Unit installieren, aber nicht starten
  --yes                 Rueckfragen ueberspringen
  --help                Diese Hilfe
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)         PORT="$2"; shift 2 ;;
    --bind)         BIND="$2"; shift 2 ;;
    --models-dir)   MODELS_DIR="$2"; shift 2 ;;
    --open-firewall) OPEN_FIREWALL=1; shift ;;
    --no-start)     START=0; shift ;;
    --yes|-y)       ASSUME_YES=1; shift ;;
    --help|-h)      usage; exit 0 ;;
    *)              echo "Unbekannte Option: $1"; usage; exit 1 ;;
  esac
done

[[ "${EUID}" -eq 0 ]] && die "Bitte NICHT mit sudo ausfuehren. Der Dienst laeuft als dein Benutzer, weil podman rootless laeuft."

bold "1/7  Voraussetzungen pruefen"

command -v node >/dev/null 2>&1 || die "node fehlt. Auf Fedora: sudo dnf install nodejs22"
NODE_BIN="$(command -v node)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
NODE_MINOR="$(node -p 'process.versions.node.split(".")[1]')"
if (( NODE_MAJOR < 20 || (NODE_MAJOR == 20 && NODE_MINOR < 11) )); then
  die "Node $(node -v) ist zu alt, benoetigt wird >= 20.11. Auf Fedora: sudo dnf install nodejs22"
fi
ok "node $(node -v) ($NODE_BIN)"

command -v npm >/dev/null 2>&1 || die "npm fehlt."
command -v git >/dev/null 2>&1 || die "git fehlt."
command -v podman >/dev/null 2>&1 || die "podman fehlt. Auf Fedora: sudo dnf install podman"
ok "podman $(podman --version | awk '{print $3}')"
command -v python3 >/dev/null 2>&1 || warn "python3 fehlt — der VRAM-Schaetzer bleibt deaktiviert."

if command -v hf >/dev/null 2>&1; then
  ok "hf $(hf --version 2>/dev/null | head -n1)"
else
  warn "hf fehlt — Modell-Downloads bleiben deaktiviert."
  warn "  Nachinstallieren mit: pipx install 'huggingface_hub[cli]'"
fi

if [[ -z "${XDG_RUNTIME_DIR:-}" ]]; then
  die "XDG_RUNTIME_DIR ist nicht gesetzt — 'systemctl --user' funktioniert so nicht. Melde dich richtig an (nicht via 'su')."
fi
systemctl --user show-environment >/dev/null 2>&1 || die "Der systemd-User-Manager ist nicht erreichbar."
ok "systemd --user erreichbar"

GROUPS_LIST="$(id -nG)"
for grp in video render; do
  if [[ " $GROUPS_LIST " != *" $grp "* ]]; then
    warn "Du bist nicht in der Gruppe '$grp'. Container mit /dev/kfd starten sonst nicht."
    warn "  Beheben mit: sudo usermod -aG video,render $USER   (danach neu anmelden)"
  fi
done

# Same amdgpu probe the gpu-workload-watch installer uses.
FOUND_GPU=0
for card in /sys/class/drm/card*/device/vendor; do
  [[ -r "$card" ]] || continue
  if [[ "$(cat "$card")" == "0x1002" ]]; then FOUND_GPU=1; break; fi
done
if [[ $FOUND_GPU -eq 1 ]]; then ok "AMD-GPU in sysfs gefunden"; else warn "Keine AMD-GPU in sysfs gefunden — das Monitoring bleibt leer."; fi

bold "2/7  Abhaengigkeiten installieren und Frontend bauen"
cd "$WEBUI_DIR"
npm ci
npm run build
ok "Frontend gebaut nach web/dist"

bold "3/7  Verzeichnisse anlegen"
mkdir -p "$CONFIG_DIR" "$STATE_DIR"
chmod 700 "$CONFIG_DIR" "$STATE_DIR"
ok "$CONFIG_DIR"
ok "$STATE_DIR"

mkdir -p "$MODELS_DIR"
ok "Modellverzeichnis $MODELS_DIR"

bold "4/7  Konfiguration"
CONFIG_FILE="$CONFIG_DIR/config.json"

# init-config.js prints a generated password only on a fresh install; a re-run
# updates port/bind/modelsDir and leaves credentials alone.
GENERATED_PASSWORD="$(SHX_CONFIG_DIR="$CONFIG_DIR" node "$WEBUI_DIR/server/src/bin/init-config.js" "$PORT" "$BIND" "$MODELS_DIR")"

if [[ -n "$GENERATED_PASSWORD" ]]; then
  ok "Neue Konfiguration angelegt."
else
  ok "config.json existierte bereits — Zugangsdaten bleiben unveraendert."
fi
chmod 600 "$CONFIG_FILE"

bold "5/7  systemd-Unit installieren"
mkdir -p "$UNIT_DIR"
sed -e "s|%REPO_WEBUI%|$WEBUI_DIR|g" -e "s|%NODE_BIN%|$NODE_BIN|g" \
  "$WEBUI_DIR/systemd/$SERVICE_NAME.service.in" > "$UNIT_DIR/$SERVICE_NAME.service"
systemctl --user daemon-reload
ok "$UNIT_DIR/$SERVICE_NAME.service"

if [[ $START -eq 1 ]]; then
  systemctl --user enable --now "$SERVICE_NAME.service"
  sleep 1
  systemctl --user --no-pager --lines=5 status "$SERVICE_NAME.service" || true
else
  systemctl --user enable "$SERVICE_NAME.service"
  ok "Unit aktiviert, aber nicht gestartet (--no-start)."
fi

bold "6/7  Autostart beim Boot"
# Ohne Lingering beendet systemd den User-Manager beim Abmelden — der Dienst
# wuerde dann beim Boot nie starten.
if loginctl show-user "$USER" --property=Linger 2>/dev/null | grep -q 'Linger=yes'; then
  ok "Lingering ist bereits aktiv."
elif loginctl enable-linger "$USER" 2>/dev/null; then
  ok "Lingering aktiviert."
elif sudo loginctl enable-linger "$USER"; then
  ok "Lingering aktiviert (via sudo)."
else
  warn "Lingering konnte nicht aktiviert werden. Der Dienst startet dann erst nach deinem Login."
  warn "  Manuell: sudo loginctl enable-linger $USER"
fi

bold "7/7  Firewall"
if [[ $OPEN_FIREWALL -eq 1 ]]; then
  sudo firewall-cmd --add-port="$PORT/tcp" --permanent && sudo firewall-cmd --reload
  ok "Port $PORT/tcp freigegeben."
else
  warn "Port $PORT ist moeglicherweise durch die Firewall blockiert. Freigeben mit:"
  echo "    sudo firewall-cmd --add-port=$PORT/tcp --permanent && sudo firewall-cmd --reload"
fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[[ -z "$IP" ]] && IP="$(hostname)"

echo
bold "Fertig."
echo "  URL:      http://$IP:$PORT/"
echo "  Benutzer: admin"
if [[ -n "$GENERATED_PASSWORD" ]]; then
  echo
  printf '  \033[1;33m┌────────────────────────────────────────────┐\033[0m\n'
  printf '  \033[1;33m│\033[0m  Passwort: \033[1m%-31s\033[0m \033[1;33m│\033[0m\n' "$GENERATED_PASSWORD"
  printf '  \033[1;33m│\033[0m  Dies wird nur EINMAL angezeigt.           \033[1;33m│\033[0m\n'
  printf '  \033[1;33m└────────────────────────────────────────────┘\033[0m\n'
fi
echo
echo "  Logs:     journalctl --user -u $SERVICE_NAME -f"
echo "  Neustart: systemctl --user restart $SERVICE_NAME"
echo "  Passwort: $WEBUI_DIR/scripts/shx-passwd"
echo
