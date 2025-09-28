#!/usr/bin/env bash
set -uo pipefail

MODEL_DIR="$(realpath models)"
RESULTDIR="results"
mkdir -p "$RESULTDIR"

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
  [rocm6_4_4-rocwmma]="toolbox run -c llama-rocm-6.4.4-rocwmma -- /usr/local/bin/llama-bench"
  [rocm7_rc]="toolbox run -c llama-rocm-7rc -- /usr/local/bin/llama-bench"
  [rocm7_rc-rocwmma]="toolbox run -c llama-rocm-7rc-rocwmma -- /usr/local/bin/llama-bench"
  [vulkan_amdvlk]="toolbox run -c llama-vulkan-amdvlk -- /usr/sbin/llama-bench"
  [vulkan_radv]="toolbox run -c llama-vulkan-radv -- /usr/sbin/llama-bench"
)

for MODEL_PATH in "${MODEL_PATHS[@]}"; do
  MODEL_NAME="$(basename "$MODEL_PATH" .gguf)"

  for ENV in "${!CMDS[@]}"; do
    CMD="${CMDS[$ENV]}"

    # For ROCm 6.4.4 and 7 envs, run default + HIPBLASLT=0 variants; others: default only
    if [[ "$ENV" == rocm7_* || "$ENV" == rocm6_4_* ]]; then
      HBLT_MODES=( default off )
    else
      HBLT_MODES=( default )
    fi

    for MODE in "${HBLT_MODES[@]}"; do
      BASE_SUFFIX=""
      CMD_EFFECTIVE="$CMD"
      if [[ "$MODE" == off ]]; then
        BASE_SUFFIX="__hblt0"
        # inject env inside the container invocation: after the "--"
        CMD_EFFECTIVE="${CMD_EFFECTIVE/-- /-- env ROCBLAS_USE_HIPBLASLT=0 }"
      fi

      # run twice: baseline and with flash attention
      for FA in 0 1; do
        SUFFIX="$BASE_SUFFIX"
        EXTRA_ARGS=()
        if (( FA == 1 )); then
          SUFFIX="${SUFFIX}__fa1"
          EXTRA_ARGS=( -fa 1 )
        fi

        OUT="$RESULTDIR/${MODEL_NAME}__${ENV}${SUFFIX}.log"

        # skip if we already have a non-empty log
        if [[ -s "$OUT" ]]; then
          echo "⏩ Skipping [${ENV}] ${MODEL_NAME}${SUFFIX:+ ($SUFFIX)}, log already exists at $OUT"
          continue
        fi

        # build command array
        FULL_CMD=( $CMD_EFFECTIVE -ngl 99 -mmp 0 -m "$MODEL_PATH" "${EXTRA_ARGS[@]}" )

        printf "\n▶ [%s] %s%s\n" "$ENV" "$MODEL_NAME" "${SUFFIX:+ $SUFFIX}"
        printf "  → log: %s\n" "$OUT"
        printf "  → cmd: %s\n\n" "${FULL_CMD[*]}"

        # execute
        "${FULL_CMD[@]}" >"$OUT" 2>&1 || {
          echo "✖ ! [${ENV}] ${MODEL_NAME}${SUFFIX:+ $SUFFIX} failed (exit $?)" >>"$OUT"
          echo "  * [${ENV}] ${MODEL_NAME}${SUFFIX:+ $SUFFIX} : FAILED"
        }
      done
    done
  done
done
