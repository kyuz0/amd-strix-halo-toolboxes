#!/usr/bin/env bash
set -uo pipefail

MODEL_DIR="$(realpath ~/models)"
RESULTDIR="results"
mkdir -p "$RESULTDIR"

# ═══════════════════════════════════════════════════════════════════════════════
# OOM Recovery System
# ═══════════════════════════════════════════════════════════════════════════════
#
# When llama-bench gets OOM-killed, the Linux OOM killer can also kill
# systemd --user (same cgroup), which breaks podman's cgroup management.
# All subsequent toolbox commands silently fail with:
#   "Error: unable to find user <user>: no matching entries in passwd file"
#
# Recovery requires:
#   1. sudo systemctl restart user@<uid>   (restart dead systemd --user)
#   2. podman stop --all                    (clean up zombie containers)
#
# For unattended runs, add to /etc/sudoers.d/toolbox-recovery:
#   <user> ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart user@<uid>
# ═══════════════════════════════════════════════════════════════════════════════

RECOVERY_WAIT_SECS=3
MAX_RECOVERY_ATTEMPTS=2
_recovery_count=0

# --- Container / Backend Configuration ---
declare -A CONTAINERS=(
  [rocm6_4_4]="llama-rocm-6.4.4"
  [rocm-7_2_4]="llama-rocm-7.2.4"
  [rocm7-nightlies]="llama-rocm7-nightlies"
  [vulkan_amdvlk]="llama-vulkan-amdvlk"
  [vulkan_radv]="llama-vulkan-radv"
)

declare -A BENCH_BINS=(
  [rocm6_4_4]="/usr/local/bin/llama-bench"
  [rocm-7_2_3]="/usr/local/bin/llama-bench"
  [rocm7-nightlies]="/usr/local/bin/llama-bench"
  [vulkan_amdvlk]="/usr/sbin/llama-bench"
  [vulkan_radv]="/usr/sbin/llama-bench"
)

# --- Health Check & Recovery Functions ---

# Check if systemd --user is alive
check_systemd_user() {
  systemctl --user status &>/dev/null
}

# Check if a specific toolbox container is functional
check_toolbox_health() {
  local container="$1"
  local output
  output=$(toolbox run -c "$container" echo "health_ok" 2>&1)
  [[ "$output" == *"health_ok"* ]]
}

# Recover from OOM-induced toolbox/podman failure
# Returns 0 on success, 1 on failure
recover_toolbox_system() {
  (( _recovery_count++ ))
  if (( _recovery_count > MAX_RECOVERY_ATTEMPTS )); then
    echo "  ✖ Max recovery attempts ($MAX_RECOVERY_ATTEMPTS) exceeded, giving up"
    echo "  → Manual fix: sudo systemctl restart user@$(id -u) && podman stop --all"
    return 1
  fi

  echo ""
  echo "🔧 ═══════════════════════════════════════════════════════════════"
  echo "🔧  Toolbox/Podman recovery (attempt ${_recovery_count}/${MAX_RECOVERY_ATTEMPTS})"
  echo "🔧 ═══════════════════════════════════════════════════════════════"

  # Step 1: Restart systemd --user if dead
  if ! check_systemd_user; then
    echo "  → systemd --user is dead, restarting..."
    if sudo systemctl restart "user@$(id -u)"; then
      echo "  ✔ systemd --user restarted"
      sleep "$RECOVERY_WAIT_SECS"
    else
      echo "  ✖ Failed to restart systemd --user"
      echo "  → Ensure passwordless sudo is configured (see header comments)"
      return 1
    fi
  else
    echo "  → systemd --user is alive"
  fi

  # Step 2: Stop all zombie containers
  echo "  → Stopping all zombie containers..."
  podman stop --all 2>/dev/null
  sleep 1

  # Step 3: Verify systemd is alive after container cleanup
  if ! check_systemd_user; then
    echo "  ✖ systemd --user died again after container cleanup"
    return 1
  fi

  echo "  ✔ Recovery complete"
  echo ""
  return 0
}

# Pre-flight checks before starting benchmarks
preflight_check() {
  echo "🔍 Pre-flight checks"
  echo "───────────────────────────────────────────────────"

  # Check sudo access for recovery
  if sudo -n true &>/dev/null; then
    echo "  ✔ Passwordless sudo available for auto-recovery"
  else
    echo "  ⚠ Passwordless sudo NOT available"
    echo "    → Auto-recovery will prompt for password (or fail in unattended mode)"
    echo "    → Fix: sudo visudo -f /etc/sudoers.d/toolbox-recovery"
    echo "    → Add: $USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart user@$(id -u)"
  fi

  # Check systemd --user
  if check_systemd_user; then
    echo "  ✔ systemd --user is running"
  else
    echo "  ⚠ systemd --user is dead — recovering before start..."
    if ! recover_toolbox_system; then
      echo "  ✖ Cannot recover toolbox system, aborting"
      exit 1
    fi
  fi

  # Spot-check one container
  local first_container="${CONTAINERS[${!CONTAINERS[*]%% *}]}"
  if check_toolbox_health "$first_container"; then
    echo "  ✔ Toolbox health check passed ($first_container)"
  else
    echo "  ⚠ Toolbox health check failed ($first_container) — recovering..."
    if ! recover_toolbox_system; then
      echo "  ✖ Cannot recover toolbox system, aborting"
      exit 1
    fi
  fi

  echo ""
}

# Run a benchmark with automatic failure detection and recovery
# Usage: run_bench_with_recovery <env> <container> <out_file> <label> <cmd_args...>
# Returns: 0 = success, 1 = legitimate failure (OOM etc.), 2 = unrecoverable system failure
#
# On failure, checks if the toolbox system is broken (OOM killed systemd).
# If broken: recovers the system and moves on (does NOT retry — the same
# benchmark would just OOM again). If healthy: it was a legit failure.
run_bench_with_recovery() {
  local env="$1" container="$2" out_file="$3" label="$4"
  shift 4
  local -a cmd_args=("$@")

  "${cmd_args[@]}" >"$out_file" 2>&1
  local exit_code=$?

  if (( exit_code == 0 )); then
    return 0  # success
  fi

  # --- Failure: determine if it's a system issue or legitimate benchmark failure ---
  echo "  ⚠ Benchmark exited with code $exit_code, checking system health..."

  if check_toolbox_health "$container"; then
    # Toolbox is fine → legitimate failure (OOM kill, model too large, etc.)
    echo "  → Toolbox is healthy — benchmark failure (OOM / model issue), moving on"
    echo "✖ ${label} failed (exit ${exit_code})" >>"$out_file"
    return 1
  fi

  # --- System failure detected → recover and continue to next benchmark ---
  echo "  → Toolbox is broken — initiating recovery..."
  rm -f "$out_file"  # Remove invalid log so it can be retried in a future run

  if ! recover_toolbox_system; then
    echo "  ✖ Recovery failed — aborting"
    return 2
  fi

  # Verify recovery worked for this specific container
  if ! check_toolbox_health "$container"; then
    echo "  ✖ Container $container still broken after recovery"
    return 2
  fi

  _recovery_count=0  # Reset counter on successful recovery
  echo "  ✔ System recovered — skipping this benchmark, continuing with next"
  return 1
}

# ═══════════════════════════════════════════════════════════════════════════════
# Capture system info
# ═══════════════════════════════════════════════════════════════════════════════
if [[ ! -f "$RESULTDIR/system_info.json" ]]; then
    python3 -c '
import platform, json, datetime
def get_distro():
    try:
        with open("/etc/os-release") as f:
            for line in f:
                if line.startswith("PRETTY_NAME="):
                    return line.split("=", 1)[1].strip().strip("\"")
    except:
        return "Linux"
    return "Linux"

def get_linux_firmware():
    try:
        import subprocess
        result = subprocess.run(["rpm", "-q", "linux-firmware"], capture_output=True, text=True)
        if result.returncode == 0:
            return result.stdout.strip()
    except:
        pass
    return "unknown"

info = {
    "distro": get_distro(),
    "kernel": platform.release(),
    "linux_firmware": get_linux_firmware(),
    "timestamp": datetime.datetime.now().strftime("%d %b %Y")
}
print(json.dumps(info))
' > "$RESULTDIR/system_info.json"
    echo "Captured system info to $RESULTDIR/system_info.json"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# Discover models
# ═══════════════════════════════════════════════════════════════════════════════

# Pick exactly one .gguf per model: either
#  - any .gguf without "-000*-of-" (single-file models)
#  - or the first shard "*-00001-of-*.gguf"
mapfile -t MODEL_PATHS < <(
  find "$MODEL_DIR" -type f -name '*.gguf' \
    \( -name '*-00001-of-*.gguf' -o -not -name '*-000*-of-*.gguf' \) \
    | sort
)

if (( ${#MODEL_PATHS[@]} == 0 )); then
  echo "❌ No models found under $MODEL_DIR – check your paths/patterns!"
  exit 1
fi

echo "Found ${#MODEL_PATHS[@]} model(s) to bench:"
for p in "${MODEL_PATHS[@]}"; do
  echo "  • $p"
done
echo

# ═══════════════════════════════════════════════════════════════════════════════
# Pre-flight & Main benchmark loop
# ═══════════════════════════════════════════════════════════════════════════════

preflight_check

ABORT_ALL=0

for MODEL_PATH in "${MODEL_PATHS[@]}"; do
  MODEL_NAME="$(basename "$MODEL_PATH" .gguf)"

  for ENV in "${!CONTAINERS[@]}"; do
    if (( ABORT_ALL )); then
      echo "⛔ Aborting due to unrecoverable system failure"
      exit 1
    fi

    CONTAINER="${CONTAINERS[$ENV]}"
    BENCH_BIN="${BENCH_BINS[$ENV]}"
    CMD_PREFIX=( toolbox run -c "$CONTAINER" -- "$BENCH_BIN" )

    # run with flash attention
    for FA in 1; do
      SUFFIX=""
      EXTRA_ARGS=()
      if (( FA == 1 )); then
        SUFFIX="__fa1"
        EXTRA_ARGS=( -fa 1 )
      fi

      for CTX in default longctx32768 longctx65536; do
        CTX_SUFFIX=""
        CTX_ARGS=()
        if [[ "$CTX" == longctx32768 ]]; then
          CTX_SUFFIX="__longctx32768"
          CTX_ARGS=( -p 2048 -n 32 -d 32768 )
          if [[ "$ENV" == *vulkan* ]]; then
            CTX_ARGS+=( -ub 512 )
          else
            CTX_ARGS+=( -ub 2048 )
          fi
        elif [[ "$CTX" == longctx65536 ]]; then
          CTX_SUFFIX="__longctx65536"
          CTX_ARGS=( -p 2048 -n 32 -d 65536 )
          if [[ "$ENV" == *vulkan* ]]; then
            CTX_ARGS+=( -ub 512 )
          else
            CTX_ARGS+=( -ub 2048 )
          fi
        fi

        OUT="$RESULTDIR/${MODEL_NAME}__${ENV}${SUFFIX}${CTX_SUFFIX}.log"
        CTX_REPS=5
        if [[ "$CTX" == longctx32768 ]] || [[ "$CTX" == longctx65536 ]]; then
          CTX_REPS=3
        fi

        if [[ -s "$OUT" ]]; then
          echo "⏩ Skipping [${ENV}] ${MODEL_NAME}${SUFFIX}${CTX_SUFFIX:+ ($CTX_SUFFIX)}, log already exists at $OUT"
          continue
        fi

        LABEL="[${ENV}] ${MODEL_NAME}${SUFFIX}${CTX_SUFFIX:+ $CTX_SUFFIX}"
        FULL_CMD=( "${CMD_PREFIX[@]}" -ngl 99 -mmp 0 -m "$MODEL_PATH" "${EXTRA_ARGS[@]}" "${CTX_ARGS[@]}" -r "$CTX_REPS" )

        printf "\n▶ %s\n" "$LABEL"
        printf "  → log: %s\n" "$OUT"
        printf "  → cmd: %s\n\n" "${FULL_CMD[*]}"

        run_bench_with_recovery "$ENV" "$CONTAINER" "$OUT" "$LABEL" "${FULL_CMD[@]}"
        rc=$?

        case $rc in
          0) echo "  ✔ $LABEL : OK" ;;
          1) echo "  * $LABEL : FAILED" ;;
          2) echo "  ⛔ $LABEL : SYSTEM FAILURE — aborting all"
             ABORT_ALL=1
             break 3  # break out of CTX, FA, and ENV loops
             ;;
        esac
      done
    done
  done
done

if (( ABORT_ALL )); then
  echo ""
  echo "⛔ Benchmark run aborted due to unrecoverable system failure"
  echo "   Manual fix: sudo systemctl restart user@$(id -u) && podman stop --all"
  exit 1
fi

echo ""
echo "✅ All benchmarks complete"
