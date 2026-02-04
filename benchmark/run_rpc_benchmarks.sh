#!/usr/bin/env bash
set -euo pipefail

# Runs llama-bench in RPC mode against remote toolbox environments.
# Customize REMOTE_* variables or export them before invoking the script.

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
RESULTDIR="${RESULTDIR:-$SCRIPT_DIR/results-rpc}"
mkdir -p "$RESULTDIR"

REMOTE_TARGET="${REMOTE_HOST:-10.0.0.1}"
REMOTE_PORT="${REMOTE_PORT:-22}"
REMOTE_HOSTNAME="${REMOTE_TARGET#*@}"
RPC_HOST="${RPC_HOST:-$REMOTE_HOSTNAME}"   # address the local host uses to reach the RPC server
RPC_PORT="${RPC_PORT:-50052}"

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

  [rocm-7.2]="llama-rocm-7.2"
  [rocm7-nightlies]="llama-rocm7-nightlies"
  [vulkan_amdvlk]="llama-vulkan-amdvlk"
  [vulkan_radv]="llama-vulkan-radv"
)

declare -A CLIENT_CMDS=(
  [rocm6_4_4]="toolbox run -c llama-rocm-6.4.4 -- /usr/local/bin/llama-bench"

  [rocm-7.2]="toolbox run -c llama-rocm-7.2 -- /usr/local/bin/llama-bench"
  [rocm7-nightlies]="toolbox run -c llama-rocm7-nightlies -- /usr/local/bin/llama-bench"
  [vulkan_amdvlk]="toolbox run -c llama-vulkan-amdvlk -- /usr/sbin/llama-bench"
  [vulkan_radv]="toolbox run -c llama-vulkan-radv -- /usr/sbin/llama-bench"
)

ENVIRONMENTS=(
  rocm6_4_4

  rocm-7.2
  rocm7-nightlies
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

has_pending_runs() {
  local env="$1"
  local suffix="$2"

  for model_path in "${RESOLVED_MODELS[@]}"; do
    local model_name
    model_name="$(basename "${model_path}" .gguf)"
    for ctx in default longctx32768; do
      local ctx_suffix=""
      if [[ "$ctx" == longctx32768 ]]; then
        ctx_suffix="__longctx32768"
      fi

      local log_file="$RESULTDIR/${model_name}__${env}${suffix}${ctx_suffix}__rpc.log"
      if [[ ! -s "$log_file" ]]; then
        return 0  # still work to do
      fi
    done
  done

  return 1  # all logs already exist
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

  ssh -p "$REMOTE_PORT" "$REMOTE_TARGET" 'bash -s' <<EOF
set -euo pipefail
pkill -9 -f rpc-server || true
nohup toolbox run -c ${image} -- ${env_prefix}rpc-server -H 0.0.0.0 -p ${RPC_PORT} -c >${remote_log} 2>&1 < /dev/null &
echo \$!
EOF
}

stop_remote_rpc() {
  local env="$1"
  local pid="$2"
  ssh -p "$REMOTE_PORT" "$REMOTE_TARGET" 'bash -s' <<EOF
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
  local mode="$4"
  local model_name
  model_name="$(basename "${model_path}" .gguf)"
  local client_cmd="${CLIENT_CMDS[$env]:-}"

  if [[ ! -f "$model_path" ]]; then
    echo "[SKIP] ${model_path} does not exist."
    return
  fi

  if [[ -z "$client_cmd" ]]; then
    echo "[WARN] No client llama-bench command defined for ${env} - skipping."
    return
  fi

  if [[ "$env" == rocm* ]]; then
    if [[ "$mode" == off ]]; then
      client_cmd="${client_cmd/-- /-- env ROCBLAS_USE_HIPBLASLT=0 }"
    else
      client_cmd="${client_cmd/-- /-- env ROCBLAS_USE_HIPBLASLT=1 }"
    fi
  fi

  local -a client_cmd_ary
  # shellcheck disable=SC2206 # intentional word splitting
  client_cmd_ary=( $client_cmd )

  for ctx in default longctx32768; do
    local ctx_suffix=""
    local ctx_reps=3
    local -a ctx_args=()
    if [[ "$ctx" == longctx32768 ]]; then
      ctx_suffix="__longctx32768"
      ctx_reps=1
      ctx_args=( -p 2048 -n 32 -d 32768 )
      if [[ "$env" == *vulkan* ]]; then
        ctx_args+=( -ub 512 )
      else
        ctx_args+=( -ub 2048 )
      fi
    fi

    local log_file="$RESULTDIR/${model_name}__${env}${suffix}${ctx_suffix}__rpc.log"
    if [[ -s "$log_file" ]]; then
      echo "[SKIP] ${log_file} already exists."
      continue
    fi

    kill_local_llamabench

    echo
    echo "> [${env}${suffix}] ${model_name} (${ctx})"
    echo "  -> log: ${log_file}"

    local -a cmd=(
      "${client_cmd_ary[@]}"
      -mmp 0
      -m "$model_path"
      -fa 1
      "${ctx_args[@]}"
      -r "$ctx_reps"
      --rpc "${RPC_HOST}:${RPC_PORT}"
    )

    printf "  -> cmd: %s\n" "${cmd[*]}"
    if "${cmd[@]}" >"$log_file" 2>&1; then
      echo "  [OK] Completed"
    else
      echo "[ERROR] llama-bench failed for ${env} / ${model_name} (see ${log_file})"
    fi
  done
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

      if ! has_pending_runs "$env" "$suffix"; then
        echo "[SKIP] ${env}${suffix} already has logs for all models - moving on."
        continue
      fi

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

      if ! wait_for_rpc "$RPC_HOST" "$RPC_PORT"; then
        echo "[ERROR] RPC server on ${RPC_HOST}:${RPC_PORT} did not become ready."
        stop_remote_rpc "$env" "$remote_pid" || true
        CURRENT_REMOTE_PID=""
        CURRENT_REMOTE_ENV=""
        continue
      fi

      for model in "${RESOLVED_MODELS[@]}"; do
        run_llama_bench_rpc "$model" "$env" "$suffix" "$mode"
      done

      stop_remote_rpc "$env" "$remote_pid" || true
      CURRENT_REMOTE_PID=""
      CURRENT_REMOTE_ENV=""
    done
  done
}

run_all
