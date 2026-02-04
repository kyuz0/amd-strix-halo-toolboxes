#!/usr/bin/env bash
set -uo pipefail

MODEL_DIR="$(realpath models)"
RESULTDIR="results"
mkdir -p "$RESULTDIR"

# Capture system info
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

declare -A CMDS=(
  [rocm6_4_4]="toolbox run -c llama-rocm-6.4.4 -- /usr/local/bin/llama-bench"

  [rocm-7.2]="toolbox run -c llama-rocm-7.2 -- /usr/local/bin/llama-bench"
  [rocm7-nightlies]="toolbox run -c llama-rocm7-nightlies -- /usr/local/bin/llama-bench"
  [vulkan_amdvlk]="toolbox run -c llama-vulkan-amdvlk -- /usr/sbin/llama-bench"
  [vulkan_radv]="toolbox run -c llama-vulkan-radv -- /usr/sbin/llama-bench"
)

get_hblt_modes() {
  local env="$1"
  if [[ "$env" == rocm* ]]; then
    printf '%s\n' default off
  else
    printf '%s\n' default
  fi
}

for MODEL_PATH in "${MODEL_PATHS[@]}"; do
  MODEL_NAME="$(basename "$MODEL_PATH" .gguf)"

  for ENV in "${!CMDS[@]}"; do
    CMD="${CMDS[$ENV]}"
    mapfile -t HBLT_MODES < <(get_hblt_modes "$ENV")

    for MODE in "${HBLT_MODES[@]}"; do
      BASE_SUFFIX=""
      CMD_EFFECTIVE="$CMD"

      if [[ "$ENV" == rocm* ]]; then
        if [[ "$MODE" == off ]]; then
          BASE_SUFFIX="__hblt0"
          CMD_EFFECTIVE="${CMD_EFFECTIVE/-- /-- env ROCBLAS_USE_HIPBLASLT=0 }"
        else
          CMD_EFFECTIVE="${CMD_EFFECTIVE/-- /-- env ROCBLAS_USE_HIPBLASLT=1 }"
        fi
      fi

      # run twice: baseline and with flash attention
      for FA in 1; do
        SUFFIX="$BASE_SUFFIX"
        EXTRA_ARGS=()
        if (( FA == 1 )); then
          SUFFIX="${SUFFIX}__fa1"
          EXTRA_ARGS=( -fa 1 )
        fi

        for CTX in default longctx32768; do
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
          fi

          OUT="$RESULTDIR/${MODEL_NAME}__${ENV}${SUFFIX}${CTX_SUFFIX}.log"
          CTX_REPS=5
          if [[ "$CTX" == longctx32768 ]]; then
            CTX_REPS=3
          fi

          if [[ -s "$OUT" ]]; then
            echo "⏩ Skipping [${ENV}] ${MODEL_NAME}${SUFFIX}${CTX_SUFFIX:+ ($CTX_SUFFIX)}, log already exists at $OUT"
            continue
          fi

          FULL_CMD=( $CMD_EFFECTIVE -ngl 99 -mmp 0 -m "$MODEL_PATH" "${EXTRA_ARGS[@]}" "${CTX_ARGS[@]}" -r "$CTX_REPS" )

          printf "\n▶ [%s] %s%s%s\n" "$ENV" "$MODEL_NAME" "${SUFFIX:+ $SUFFIX}" "${CTX_SUFFIX:+ $CTX_SUFFIX}"
          printf "  → log: %s\n" "$OUT"
          printf "  → cmd: %s\n\n" "${FULL_CMD[*]}"

          if ! "${FULL_CMD[@]}" >"$OUT" 2>&1; then
            status=$?
            echo "✖ ! [${ENV}] ${MODEL_NAME}${SUFFIX}${CTX_SUFFIX:+ $CTX_SUFFIX} failed (exit ${status})" >>"$OUT"
            echo "  * [${ENV}] ${MODEL_NAME}${SUFFIX}${CTX_SUFFIX:+ $CTX_SUFFIX} : FAILED"
          fi
        done
      done
    done
  done
done
