#!/usr/bin/env bash
#
# Proves that webui's argv builder produces exactly what run-llama-server.sh
# would have executed — by running the real script against a fake podman that
# just prints its arguments, and diffing that against our builder's output.
#
# This is the check that matters: it validates against the script itself rather
# than against anyone's reading of it. Run it after touching podman/argv.js.
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEBUI="$(cd "$HERE/../.." && pwd)"
REPO="$(cd "$WEBUI/.." && pwd)"
SCRIPT="$REPO/run-llama-server.sh"
WORK="$WEBUI/dev/tmp/parity"

[[ -f "$SCRIPT" ]] || { echo "run-llama-server.sh nicht gefunden unter $SCRIPT" >&2; exit 1; }

rm -rf "$WORK"
mkdir -p "$WORK/bin" "$WORK/models"
cp "$HERE/fake-podman" "$WORK/bin/podman"
chmod +x "$WORK/bin/podman"

export PATH="$WORK/bin:$PATH"
# Pin the script's autodetect so both sides get the same extra-args spelling.
export SHX_PARITY_HELP="$WEBUI/dev/fixtures/llama-server-help-old.txt"

MODELS_DIR="$WORK/models"
PASS=0
FAIL=0

mkdir -p "$MODELS_DIR/Qwen3.6-27B-GGUF/Q8_0" "$MODELS_DIR/gpt-oss-120b-GGUF/F16"
: > "$MODELS_DIR/Qwen3.6-27B-GGUF/Q8_0/Qwen3.6-27B-Q8_0.gguf"
: > "$MODELS_DIR/gpt-oss-120b-GGUF/F16/gpt-oss-120b-F16-00001-of-00003.gguf"

# run_case <label> <json-spec> -- <script flags...>
# Flags travel as real argv so a value containing spaces stays one argument.
run_case() {
  local label="$1" spec="$2"
  shift 3 # label, spec, and the literal --
  local -a flags=("$@")

  local expected="$WORK/expected.txt" actual="$WORK/actual.txt"

  bash "$SCRIPT" "${flags[@]}" --models-dir "$MODELS_DIR" > "$WORK/script-output.txt" 2>&1 || true

  # The script prints a summary before invoking podman and a success message
  # after it. Keep only what the fake podman echoed: from the leading "run"
  # up to the blank line that follows the last argument.
  awk '/^run$/{found=1} found && NF==0 {exit} found{print}' "$WORK/script-output.txt" > "$expected"

  if [[ ! -s "$expected" ]]; then
    printf '  \033[31m✗\033[0m %s — das Script hat podman nicht aufgerufen:\n' "$label"
    sed 's/^/      /' "$WORK/script-output.txt" | head -n 5
    FAIL=$((FAIL + 1))
    return
  fi

  node "$HERE/build.js" "$spec" > "$actual"

  if diff -u "$expected" "$actual" > "$WORK/diff.txt"; then
    printf '  \033[32m✓\033[0m %s\n' "$label"
    PASS=$((PASS + 1))
  else
    printf '  \033[31m✗\033[0m %s\n' "$label"
    sed 's/^/      /' "$WORK/diff.txt"
    FAIL=$((FAIL + 1))
  fi
}

IMAGE_RADV="docker.io/st3v0rr/amd-strix-halo-toolboxes:vulkan-radv"
IMAGE_ROCM="docker.io/st3v0rr/amd-strix-halo-toolboxes:rocm-7.14"
MODEL_A="Qwen3.6-27B-GGUF/Q8_0/Qwen3.6-27B-Q8_0.gguf"
MODEL_SHARD="gpt-oss-120b-GGUF/F16/gpt-oss-120b-F16-00001-of-00003.gguf"

spec() {
  # spec <name> <image> <port> <modelPath> <apiKey> <ctx> <ngl> <threads> <extraArgs>
  cat <<EOF
{"containerName":"$1","image":"$2","hostPort":$3,"modelPath":"$4","apiKey":"$5",
 "modelsDir":"$MODELS_DIR","ctxSize":$6,"gpuLayers":$7,"threads":$8,"extraArgs":"$9"}
EOF
}

echo "Parity: webui/server/src/podman/argv.js  vs  run-llama-server.sh"
echo

run_case "Standardfall" \
  "$(spec llamacpp-server "$IMAGE_RADV" 11434 "$MODEL_A" example-key 65536 999 12 '-fa 1 --no-mmap')" \
  -- --model "$MODEL_A" --api-key example-key

run_case "Praefix models/ im Modellpfad" \
  "$(spec llamacpp-server "$IMAGE_RADV" 11434 "models/$MODEL_A" example-key 65536 999 12 '-fa 1 --no-mmap')" \
  -- --model "models/$MODEL_A" --api-key example-key

run_case "Gesharded, zweiter Port, eigener Name, ROCm-Image" \
  "$(spec llama-rocm-7.14 "$IMAGE_ROCM" 11435 "$MODEL_SHARD" k2 65536 999 12 '-fa 1 --no-mmap')" \
  -- --model "$MODEL_SHARD" --api-key k2 --name llama-rocm-7.14 --port 11435 --image "$IMAGE_ROCM"

run_case "Abweichende ctx/threads/gpu-layers" \
  "$(spec llamacpp-server "$IMAGE_RADV" 11434 "$MODEL_A" k3 90000 99 16 '-fa 1 --no-mmap')" \
  -- --model "$MODEL_A" --api-key k3 --ctx-size 90000 --threads 16 --gpu-layers 99

run_case "Neue Flash-Attention-Schreibweise via --extra-args" \
  "$(spec llamacpp-server "$IMAGE_RADV" 11434 "$MODEL_A" k4 65536 999 12 '-fa on --load-mode none')" \
  -- --model "$MODEL_A" --api-key k4 --extra-args '-fa on --load-mode none'

# The script autodetects when --extra-args is absent; point its probe at the
# new-spelling fixture and it must produce the new flags on its own.
SHX_PARITY_HELP="$WEBUI/dev/fixtures/llama-server-help-new.txt" \
run_case "Autodetect erkennt --load-mode am Image" \
  "$(spec llamacpp-server "$IMAGE_RADV" 11434 "$MODEL_A" k5 65536 999 12 '-fa on --load-mode none')" \
  -- --model "$MODEL_A" --api-key k5

echo
if [[ $FAIL -eq 0 ]]; then
  printf '\033[32m%d/%d Faelle identisch.\033[0m\n' "$PASS" "$((PASS + FAIL))"
else
  printf '\033[31m%d von %d Faellen weichen ab.\033[0m\n' "$FAIL" "$((PASS + FAIL))"
  exit 1
fi
