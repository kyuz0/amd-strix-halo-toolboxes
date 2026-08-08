#!/usr/bin/env bash
#
# End-to-end check against a running instance. Read-only apart from the login:
# it never starts, stops or deletes anything.
#
#   ./smoke.sh                        # localhost:8420, password from $SHX_PASSWORD
#   ./smoke.sh http://box:8420        # another host
#
set -uo pipefail

BASE="${1:-http://127.0.0.1:8420}"
USERNAME="${SHX_USERNAME:-admin}"
PASSWORD="${SHX_PASSWORD:-}"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

PASS=0
FAIL=0

ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; FAIL=$((FAIL+1)); }

# check <label> <expected-status> <curl args...>
check() {
  local label="$1" expected="$2"; shift 2
  local status
  status="$(curl -s -o /dev/null -w '%{http_code}' "$@")"
  if [[ "$status" == "$expected" ]]; then ok "$label ($status)"; else bad "$label: erwartet $expected, bekam $status"; fi
}

api() { curl -s -b "$JAR" "$BASE/api$1"; }
post() {
  curl -s -b "$JAR" -c "$JAR" -X POST "$BASE/api$1" \
    -H 'Content-Type: application/json' -H 'X-Requested-With: shx' -H "Origin: $BASE" \
    ${2:+-d "$2"}
}

echo "Smoke-Test gegen $BASE"
echo

echo "Erreichbarkeit"
check "GET /api/health ist offen" 200 "$BASE/api/health"
check "GET /api/servers ohne Anmeldung" 401 "$BASE/api/servers"

echo
echo "Anmeldung"
if [[ -z "$PASSWORD" ]]; then
  printf '  Passwort fuer %s: ' "$USERNAME"
  read -rs PASSWORD
  echo
fi

check "Login mit falschem Passwort" 401 -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' -H 'X-Requested-With: shx' -H "Origin: $BASE" \
  -d '{"username":"'"$USERNAME"'","password":"definitiv-falsch-'"$RANDOM"'"}'

check "Login ohne CSRF-Header" 403 -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' -H "Origin: $BASE" \
  -d '{"username":"'"$USERNAME"'","password":"'"$PASSWORD"'"}'

check "Login mit fremdem Origin" 403 -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' -H 'X-Requested-With: shx' -H 'Origin: http://evil.invalid' \
  -d '{"username":"'"$USERNAME"'","password":"'"$PASSWORD"'"}'

LOGIN="$(curl -s -c "$JAR" -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' -H 'X-Requested-With: shx' -H "Origin: $BASE" \
  -d '{"username":"'"$USERNAME"'","password":"'"$PASSWORD"'"}')"
if grep -q '"username"' <<<"$LOGIN"; then ok "Login erfolgreich"; else bad "Login fehlgeschlagen: $LOGIN"; exit 1; fi
grep -qi 'httponly' "$JAR" && ok "Cookie ist HttpOnly" || bad "Cookie ist nicht HttpOnly"

echo
echo "Kernfunktionen"
for path in /version /system /models /images /servers /profiles /settings /updates/app; do
  check "GET $path" 200 -b "$JAR" "$BASE/api$path"
done

echo
echo "Schutzmechanismen"
check "Path-Traversal beim Loeschen" 404 -b "$JAR" -X DELETE "$BASE/api/models?key=../../etc/passwd" \
  -H 'X-Requested-With: shx' -H "Origin: $BASE"

check "Unbekanntes Image" 400 -b "$JAR" -X POST "$BASE/api/images/pull" \
  -H 'Content-Type: application/json' -H 'X-Requested-With: shx' -H "Origin: $BASE" \
  -d '{"ref":"docker.io/evil/thing:latest"}'

echo
echo "Zusammenfassung"
api /system | node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
    const j=JSON.parse(s);
    const gib=(b)=>b==null?"–":(b/1024**3).toFixed(1)+" GiB";
    console.log("  GPU:", j.gpu ? `${j.gpu.busyPercent ?? "–"} % · GTT ${gib(j.gpu.gttUsed)} / ${gib(j.gpu.gttTotal)}` : "nicht gefunden");
    console.log("  RAM:", `${gib(j.memory?.usedBytes)} / ${gib(j.memory?.totalBytes)}`);
  });
' 2>/dev/null || echo "  (Zusammenfassung nicht verfuegbar)"

api /servers | node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
    const j=JSON.parse(s);
    console.log("  Server:", j.servers.length ? j.servers.map(x=>`${x.name} (${x.state})`).join(", ") : "keine");
  });
' 2>/dev/null || true

echo
if [[ $FAIL -eq 0 ]]; then
  printf '\033[32m%d/%d Pruefungen bestanden.\033[0m\n' "$PASS" "$((PASS+FAIL))"
else
  printf '\033[31m%d von %d Pruefungen fehlgeschlagen.\033[0m\n' "$FAIL" "$((PASS+FAIL))"
  exit 1
fi
