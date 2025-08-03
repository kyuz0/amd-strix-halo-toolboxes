#!/usr/bin/env bash
# run_loadtime_benchmarks.sh
# Benchmark each model with llama-cli: measure load + single-token inference times (including load time)
# Run each model/env combination 3 times and compute average elapsed time
set -uo pipefail

MODEL_DIR="$(realpath models)"
RESULTDIR="loadtime_results"
mkdir -p "$RESULTDIR"

# 1) Gather one .gguf per model (single-file or first shard)
mapfile -t MODELS < <(
  find "$MODEL_DIR" -type f -name '*.gguf' \
    \( -name '*-00001-of-*.gguf' -o ! -name '*-000*-of-*.gguf' \) \
    | sort
)
if (( ${#MODELS[@]} == 0 )); then
  echo "❌ No models found in $MODEL_DIR" >&2
  exit 1
fi

echo "Found ${#MODELS[@]} models to test with llama-cli (3 runs each)"

# 2) Define environments and llama-cli prefix
declare -A ENVS=(
  [rocm6_4_2]="toolbox run -c llama-rocm-6.4.2 -- llama-cli"
  [rocm7_beta]="toolbox run -c llama-rocm-7beta -- llama-cli"
  [rocm7_rc]="toolbox run -c llama-rocm-7rc -- llama-cli"
  [vulkan_amdvlk]="toolbox run -c llama-vulkan-amdvlk -- llama-cli"
  [vulkan_radv]="toolbox run -c llama-vulkan-radv -- llama-cli"
)

# Prompt and flags
PROMPT="Hello"
BASE_FLAGS=( -ngl 999 -fa --no-mmap -no-cnv -n 1 )
REPEATS=3

# 3) Loop models/envs
for MODEL_PATH in "${MODELS[@]}"; do
  MODEL_NAME="$(basename "${MODEL_PATH%.gguf}")"

  for ENV in "${!ENVS[@]}"; do
    # Prepare output file
    OUTFILE="$RESULTDIR/${MODEL_NAME}__${ENV}.log"
    rm -f "$OUTFILE"

    # Build command prefix array
    IFS=' ' read -r -a PREFIX_CMD <<< "${ENVS[$ENV]}"
    FLAG_ARRAY=( "${BASE_FLAGS[@]}" )

    echo
    echo "▶ [$ENV] $MODEL_NAME (runs: $REPEATS)"
    echo "  → log   : $OUTFILE"
    echo "  → flags : ${FLAG_ARRAY[*]}"

    sum=0
    success=0

    for i in $(seq 1 $REPEATS); do
      echo "  Run #$i..." >>"$OUTFILE"
      start=$(date +%s.%N)
      # Run llama-cli; suppress its output to log (no tee)
      "${PREFIX_CMD[@]}" "${FLAG_ARRAY[@]}" -m "$MODEL_PATH" -p "$PROMPT" >"$OUTFILE" 2>&1
      status=$?
      end=$(date +%s.%N)
      elapsed=$(echo "$end - $start" | bc)
      echo "    Elapsed #$i: ${elapsed}s" >>"$OUTFILE"
      echo "    Run #$i status: $status" >>"$OUTFILE"

      if [ $status -eq 0 ]; then
        sum=$(echo "$sum + $elapsed" | bc)
        ((success++))
      else
        echo "    ✖ run #$i failed" >>"$OUTFILE"
      fi
    done

    if [ $success -gt 0 ]; then
      avg=$(echo "scale=3; $sum / $success" | bc)
      echo "  → Avg over $success runs: ${avg}s" >>"$OUTFILE"
      echo "✔ [$ENV] $MODEL_NAME avg=${avg}s over $success runs"
    else
      echo "  → No successful runs" >>"$OUTFILE"
      echo "✖ [$ENV] $MODEL_NAME all runs failed"
    fi
  done
done

