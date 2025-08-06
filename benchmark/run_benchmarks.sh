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
  [rocm6_4_2]="toolbox run -c llama-rocm-6.4.2 -- /usr/local/bin/llama-bench"
  [rocm7_beta]="toolbox run -c llama-rocm-7beta -- /usr/local/bin/llama-bench"
  [rocm7_rc]="toolbox run -c llama-rocm-7rc -- /usr/local/bin/llama-bench"
  [vulkan_amdvlk]="toolbox run -c llama-vulkan-amdvlk -- /usr/sbin/llama-bench"
  [vulkan_radv]="toolbox run -c llama-vulkan-radv -- /usr/sbin/llama-bench"
)

for MODEL_PATH in "${MODEL_PATHS[@]}"; do
  MODEL_NAME="$(basename "$MODEL_PATH" .gguf)"

  for ENV in "${!CMDS[@]}"; do
    CMD="${CMDS[$ENV]}"
    OUT="$RESULTDIR/${MODEL_NAME}__${ENV}.log"

    # skip if we already have a non-empty log
    if [[ -s "$OUT" ]]; then
      echo "⏩ Skipping [${ENV}] ${MODEL_NAME}, log already exists at $OUT"
      continue
    fi

    # build command array
    FULL_CMD=( $CMD -ngl 99 -mmp 0 -m "$MODEL_PATH" )

    printf "\n▶ [%s] %s\n" "$ENV" "$MODEL_NAME"
    printf "  → log: %s\n" "$OUT"
    printf "  → cmd: %s\n\n" "${FULL_CMD[*]}"

    # execute
    "${FULL_CMD[@]}" >"$OUT" 2>&1 || {
      echo "✖ ! [${ENV}] ${MODEL_NAME} failed (exit $?)" >>"$OUT"
      echo "  * [${ENV}] ${MODEL_NAME} : FAILED"
    }
  done
done
