#!/usr/bin/env bash
set -euo pipefail

# Runs llama-bench in RPC mode against remote toolbox environments.
# Customize REMOTE_* variables or export them before invoking the script.

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
RESULTDIR="${RESULTDIR:-$SCRIPT_DIR/results-rpc}"
mkdir -p "$RESULTDIR"

REMOTE_HOST="${REMOTE_HOST:-10.0.0.1}"
REMOTE_PORT="${REMOTE_PORT:-22}"
RPC_ADDR="${RPC_ADDR:-10.0.0.1}"   # address the local host uses to reach the RPC server
RPC_PORT="${RPC_PORT:-50052}"
LLAMA_BENCH_BIN="${LLAMA_BENCH_BIN:-llama-bench}"

# Explicit list of models to test - edit as needed.
MODELS=(
  "/mnt/storage/MiniMax-M2-GGUF/UD-Q6_K_XL/MiniMax-M2-UD-Q6_K_XL-00001-of-00004.gguf"
)

if (( ${#MODELS[@]} == 0 )); then
  echo "[ERROR] MODELS list is empty - edit run_rpc_benchmarks.sh" >&2
  exit 1
fi

# Toolbox containers to exercise over RPC.
declare -A TOOLBOX_IMAGES=(
  [rocm6_4_4]="llama-rocm-6.4.4"
  [rocm6_4_4-rocwmma]="llama-rocm-6.4.4-rocwmma"
  [rocm7_1]="llama-rocm-7.1"
  [rocm7_1-rocwmma]="llama-rocm-7.1-rocwmma"
  [rocm7_rc]="llama-rocm-7rc"
  [rocm7_rc-rocwmma]="llama-rocm-7rc-rocwmma"
  [rocm7_alpha]="llama-rocm-7alpha"
  [rocm7_alpha-rocwmma]="llama-rocm-7alpha-rocwmma"
  [rocm7_alpha-rocwmma-improved]="llama-rocm-7alpha-rocwmma-improved"
  [vulkan_amdvlk]="llama-vulkan-amdvlk"
  [vulkan_radv]="llama-vulkan-radv"
)

ENVIRONMENTS=(
  rocm6_4_4
  rocm6_4_4-rocwmma
  rocm7_1
  rocm7_1-rocwmma
  rocm7_rc
  rocm7_rc-rocwmma
  rocm7_alpha
  rocm7_alpha-rocwmma
  rocm7_alpha-rocwmma-improved
  vulkan_amdvlk
  vulkan_radv
)

CURRENT_REMOTE_PID=""
CURRENT_REMOTE_ENV=""
RESOLVED_MODELS=()

cleanup_remote() {
  if [[ -n "${CURRENT_REMOTE_PID:-}" && -n "${CURRENT_REMOTE_ENV:-}" ]]; then
    stop_remote_rpc "${CURRENT_REMOTE_ENV}" "${CURRENT_REMOTE_PID}" || true
  fi
}
trap cleanup_remote EXIT

resolve_model_path() {
  local raw="$1"
  local expanded="$raw"

  if [[ "$expanded" == ~* ]]; then
    expanded="${expanded/#\~/$HOME}"
  fi

  local -a candidates=("$expanded")
  if [[ "$expanded" != /* ]]; then
    candidates+=("$SCRIPT_DIR/$expanded")
  fi

  for candidate in "${candidates[@]}"; do
    if [[ -f "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

get_hblt_modes() {
  local env="$1"
  if [[ "$env" == rocm* ]]; then
    printf '%s\n' default off
  else
    printf '%s\n' default
  fi
}

ensure_models_exist() {
  RESOLVED_MODELS=()
  for m in "${MODELS[@]}"; do
    local resolved
    if resolved="$(resolve_model_path "$m")"; then
      RESOLVED_MODELS+=("$resolved")
    else
      echo "[WARN] Missing model file: $m" >&2
    fi
  done

  if (( ${#RESOLVED_MODELS[@]} == 0 )); then
    echo "[ERROR] None of the listed models exist - adjust MODELS array." >&2
    exit 1
  fi

  echo "Models to bench:"
  for resolved in "${RESOLVED_MODELS[@]}"; do
    echo "  - $resolved"
  done
}

start_remote_rpc() {
  local env="$1"
  local image="$2"
  local mode="$3"
  local suffix="$4"
  local remote_log="/tmp/rpc-server-${env}${suffix}.log"
  local env_prefix=""

  if [[ "$env" == rocm* ]]; then
    if [[ "$mode" == off ]]; then
      env_prefix="env ROCBLAS_USE_HIPBLASLT=0 "
    else
      env_prefix="env ROCBLAS_USE_HIPBLASLT=1 "
    fi
  fi

  ssh -p "$REMOTE_PORT" "$REMOTE_HOST" 'bash -s' <<EOF
set -euo pipefail
pkill -9 -f rpc-server || true
nohup toolbox run -c ${image} -- ${env_prefix}rpc-server -H 0.0.0.0 -p ${RPC_PORT} -c >${remote_log} 2>&1 < /dev/null &
echo \$!
EOF
}

stop_remote_rpc() {
  local env="$1"
  local pid="$2"
  ssh -p "$REMOTE_PORT" "$REMOTE_HOST" 'bash -s' <<EOF
set -euo pipefail
if [[ -n "${pid}" && -e "/proc/${pid}" ]]; then
  kill -9 ${pid} || true
fi
pkill -9 -f rpc-server || true
EOF
}

wait_for_rpc() {
  local host="$1"
  local port="$2"
  local retries="${3:-30}"
  local delay="${4:-1}"

  for ((i = 1; i <= retries; i++)); do
    if exec 3<>"/dev/tcp/${host}/${port}" 2>/dev/null; then
      exec 3>&-
      exec 3<&-
      return 0
    fi
    sleep "$delay"
  done
  return 1
}

kill_local_llamabench() {
  if pkill -9 -f llama-bench 2>/dev/null; then
    sleep 1
  fi
}

run_llama_bench_rpc() {
  local model_path="$1"
  local env="$2"
  local suffix="$3"
  local model_name
  model_name="$(basename "${model_path}" .gguf)"
  local log_file="$RESULTDIR/${model_name}__${env}${suffix}__rpc.log"

  if [[ ! -f "$model_path" ]]; then
    echo "[SKIP] ${model_path} does not exist."
    return
  fi

  if [[ -s "$log_file" ]]; then
    echo "[SKIP] ${log_file} already exists."
    return
  fi

  kill_local_llamabench

  echo
  echo "> [${env}${suffix}] ${model_name}"
  echo "  -> log: ${log_file}"

  local -a cmd=(
    "$LLAMA_BENCH_BIN"
    -mmp 0
    -m "$model_path"
    -fa 1
    --rpc "${RPC_ADDR}:${RPC_PORT}"
  )

  printf "  -> cmd: %s\n" "${cmd[*]}"
  if "${cmd[@]}" >"$log_file" 2>&1; then
    echo "  [OK] Completed"
  else
    echo "[ERROR] llama-bench failed for ${env} / ${model_name} (see ${log_file})"
  fi
}

run_all() {
  ensure_models_exist

  for env in "${ENVIRONMENTS[@]}"; do
    local image="${TOOLBOX_IMAGES[$env]:-}"
    if [[ -z "${image}" ]]; then
      echo "[WARN] No toolbox mapping defined for ${env} - skipping."
      continue
    fi

    mapfile -t hblt_modes < <(get_hblt_modes "$env")

    for mode in "${hblt_modes[@]}"; do
      local suffix=""
      if [[ "$mode" == off ]]; then
        suffix="__hblt0"
      fi

      echo
      echo "==== ${env}${suffix} -> ${image} ===="

      CURRENT_REMOTE_ENV="${env}${suffix}"
      local remote_pid
      remote_pid="$(start_remote_rpc "$env" "$image" "$mode" "$suffix" | tr -d '\r')"

      if [[ -z "$remote_pid" ]]; then
        echo "[ERROR] Failed to start RPC server for ${env}${suffix}"
        CURRENT_REMOTE_ENV=""
        continue
      fi

      CURRENT_REMOTE_PID="$remote_pid"
      echo "  Remote rpc-server PID: ${remote_pid}"

      if ! wait_for_rpc "$RPC_ADDR" "$RPC_PORT"; then
        echo "[ERROR] RPC server on ${RPC_ADDR}:${RPC_PORT} did not become ready."
        stop_remote_rpc "$env" "$remote_pid" || true
        CURRENT_REMOTE_PID=""
        CURRENT_REMOTE_ENV=""
        continue
      fi

    for model in "${RESOLVED_MODELS[@]}"; do
      run_llama_bench_rpc "$model" "$env" "$suffix"
    done

      stop_remote_rpc "$env" "$remote_pid" || true
      CURRENT_REMOTE_PID=""
      CURRENT_REMOTE_ENV=""
    done
  done
}

run_all
