# Agent runbook: toolbox performance benchmarks

Use this file when an agent must calibrate, run, collect, validate, or integrate
the Strix Halo toolbox benchmarks. Do not use the cockpit TUI. Use SSH, the
cockpit calibration CLI, and the checked-in campaign scripts.

## Non-negotiable rules

- Work in `benchmark/toolbox_performance/` in this repository.
- Keep each image tag in `benchmark/toolbox_performance/<tag>/`.
- Use a fresh campaign ID and fresh results directory for every run.
- Never mix results from different image digests in one campaign directory.
- Never run two GPU workloads concurrently on one host.
- Do not delete or replace existing repository data before validating staged
  replacements and keeping a recoverable backup.
- Do not commit, push, publish images, dispatch workflows, or open a PR unless
  the user explicitly requests it.
- Do not poll multi-hour jobs frequently. Launch them detached and check after a
  suitably long interval or when the user requests status.

## Fixed benchmark settings

Do not change these settings within a comparison:

```text
platform             strix-halo
starting depths      0,8192,16384,24576,32768,40960,49152,57344,65536
prefill tokens       2048
generation tokens    128
batch                2048
repetitions          3
cooldown             10 seconds
GPU layers           99
flash attention      enabled
memory mapping       disabled
KV quantization      disabled
ubatch candidates    256,512,1024,2048
```

Calibration is an explicit step. It tests each ubatch across the complete
nine-depth prefill curve. Cockpit records the selected value in:

```text
~/.config/llama-cockpit/ubatch-calibrations.json
```

Calibration keys are platform, backend family, and exact model filename. They
are not keyed by image digest or toolbox tag.

## Available infrastructure

SSH hosts:

- `fw1`
- `fw2`

Both hosts have the toolboxes and model files. Models are under
`/home/kyuz0/models`.

Exact current model paths:

```bash
MODELS=(
  "$HOME/models/Qwen3.6-27B-MTP-GGUF/Qwen3.6-27B-UD-Q8_K_XL.gguf"
  "$HOME/models/Qwen3.6-35B-A3B-MTP-GGUF/Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf"
  "$HOME/models/Qwen3.6-35B-A3B-MTP-GGUF/Qwen3.6-35B-A3B-UD-Q8_K_XL.gguf"
  "$HOME/models/DeepSeek-V4-Flash-0731-GGUF/UD-IQ2_XXS/DeepSeek-V4-Flash-0731-UD-IQ2_XXS-00001-of-00003.gguf"
  "$HOME/models/DeepSeek-V4-Flash-0731-GGUF/UD-IQ3_XXS/DeepSeek-V4-Flash-0731-UD-IQ3_XXS-00001-of-00004.gguf"
)
```

The other DeepSeek shards must be beside the first shard.

Current comparison tags:

```text
rocm-7.14
vulkan-radv
vulkan-radv-performance
```

Do not assign a tag permanently to a host. Select either available host after
checking its current workload and toolbox state.

## Agent inputs

Set these before acting:

```bash
HOST=fw1                         # fw1 or fw2
TAG=rocm-7.14                    # one current comparison tag
TOOLBOX="llama-$TAG"
CAMPAIGN_ID="$(date -u +%Y%m%dT%H%M%SZ)-toolbox-performance"
```

Use the same `CAMPAIGN_ID` when a comparison is split across both hosts.

## 1. Read-only preflight

Run these checks before mutating a toolbox or launching work:

```bash
ssh "$HOST" "systemctl is-active gpu-workload-watch.service"
ssh "$HOST" "pgrep -af 'llama-bench|calibrate-ubatch|run_calibrated_campaign' || true"
ssh "$HOST" "toolbox list"
ssh "$HOST" "toolbox run -c '$TOOLBOX' -- llama-bench --list-devices"
ssh "$HOST" "test -f '$HOME/models/Qwen3.6-27B-MTP-GGUF/Qwen3.6-27B-UD-Q8_K_XL.gguf'"
ssh "$HOST" "test -f '$HOME/models/Qwen3.6-35B-A3B-MTP-GGUF/Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf'"
ssh "$HOST" "test -f '$HOME/models/Qwen3.6-35B-A3B-MTP-GGUF/Qwen3.6-35B-A3B-UD-Q8_K_XL.gguf'"
ssh "$HOST" "test -f '$HOME/models/DeepSeek-V4-Flash-0731-GGUF/UD-IQ2_XXS/DeepSeek-V4-Flash-0731-UD-IQ2_XXS-00001-of-00003.gguf'"
ssh "$HOST" "test -f '$HOME/models/DeepSeek-V4-Flash-0731-GGUF/UD-IQ3_XXS/DeepSeek-V4-Flash-0731-UD-IQ3_XXS-00001-of-00004.gguf'"
```

Stop if another workload is running, the watcher is inactive, a model is
missing, or `llama-bench` does not list the expected GPU.

## 2. Refresh an image only when requested

Toolbox recreation destroys the named container. Do not do this merely because
a newer image might exist. If the user requests a refresh, run the repository's
canonical refresh script on the selected host. It supplies the required device,
group, security, and host-specific Toolbx/Distrobox options:

```bash
ssh "$HOST" "bash -s -- '$TOOLBOX'" < refresh-toolboxes.sh
ssh "$HOST" "toolbox run -c '$TOOLBOX' -- llama-bench --list-devices"
```

## 3. Deploy deterministic helpers

From the repository root:

```bash
scp benchmark/toolbox_performance/run_calibrated_campaign.py "$HOST:~/"
ssh "$HOST" "llama-cockpit-calibrate-ubatch --help >/dev/null"
```

Do not upgrade or reinstall cockpit unless the user requests it or the required
CLI/helper API is missing.

## 4. Create the remote campaign launcher

Create `/tmp/run-toolbox-campaign.sh` locally with `apply_patch`, using this
content, then copy it to the selected host:

```bash
#!/usr/bin/env bash
set -euo pipefail

: "${TAG:?TAG is required}"
: "${CAMPAIGN_ID:?CAMPAIGN_ID is required}"
: "${HOST_LABEL:?HOST_LABEL is required}"

TOOLBOX="llama-$TAG"
CAMPAIGN_ROOT="$HOME/llamacpp_toolboxes_bench_results/toolbox_performance_calibrated/$CAMPAIGN_ID"
CALIBRATION_ROOT="$CAMPAIGN_ROOT/calibration"
RESULTS_DIR="$CAMPAIGN_ROOT/final/$TAG"
COCKPIT_PY="$HOME/.local/share/pipx/venvs/llama-cockpit/bin/python"
HOST_PROFILE="gpu-workload-watch (accelerator-performance and maximum fans), amd_iommu=off"

MODELS=(
  "$HOME/models/Qwen3.6-27B-MTP-GGUF/Qwen3.6-27B-UD-Q8_K_XL.gguf"
  "$HOME/models/Qwen3.6-35B-A3B-MTP-GGUF/Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf"
  "$HOME/models/Qwen3.6-35B-A3B-MTP-GGUF/Qwen3.6-35B-A3B-UD-Q8_K_XL.gguf"
  "$HOME/models/DeepSeek-V4-Flash-0731-GGUF/UD-IQ2_XXS/DeepSeek-V4-Flash-0731-UD-IQ2_XXS-00001-of-00003.gguf"
  "$HOME/models/DeepSeek-V4-Flash-0731-GGUF/UD-IQ3_XXS/DeepSeek-V4-Flash-0731-UD-IQ3_XXS-00001-of-00004.gguf"
)

mkdir -p "$CALIBRATION_ROOT"
REUSE_ARGS=()
if [[ "${CALIBRATE:-1}" == "1" ]]; then
  for model in "${MODELS[@]}"; do
    llama-cockpit-calibrate-ubatch \
      --toolbox "$TOOLBOX" \
      --model "$model" \
      --results-dir "$CALIBRATION_ROOT"
  done
  REUSE_ARGS=(--reuse-calibration)
fi

MODEL_ARGS=()
for model in "${MODELS[@]}"; do MODEL_ARGS+=(--model "$model"); done

"$COCKPIT_PY" "$HOME/run_calibrated_campaign.py" \
  --campaign-id "$CAMPAIGN_ID" \
  --host-label "$HOST_LABEL" \
  --host-profile "$HOST_PROFILE" \
  --toolbox "$TOOLBOX" \
  --results-dir "$RESULTS_DIR" \
  "${REUSE_ARGS[@]}" \
  "${MODEL_ARGS[@]}"
```

Copy it:

```bash
scp /tmp/run-toolbox-campaign.sh "$HOST:~/"
ssh "$HOST" "chmod +x '$HOME/run-toolbox-campaign.sh'"
```

Use `CALIBRATE=1` for a new backend calibration. This permits the runner to
reuse the winning prefill curve because the same toolbox produced it.

Use `CALIBRATE=0` only when a valid calibration for that backend and every exact
model filename already exists on the selected host. The runner then executes
this toolbox's own prefill and generation curves; it does not copy another
toolbox's prefill data.

## 5. Launch detached

```bash
SESSION="bench-${TAG//./-}"
CALIBRATE=1

ssh "$HOST" \
  "tmux new-session -d -s '$SESSION' 'env TAG=$TAG CAMPAIGN_ID=$CAMPAIGN_ID HOST_LABEL=$HOST CALIBRATE=$CALIBRATE ~/run-toolbox-campaign.sh'"
```

Confirm that the session and process exist, then stop polling:

```bash
ssh "$HOST" "tmux has-session -t '$SESSION' && pgrep -af 'llama-bench|calibrate-ubatch|run_calibrated_campaign'"
```

## 6. Monitor or resume

Use non-interactive snapshots:

```bash
ssh "$HOST" "tmux capture-pane -p -t '$SESSION' -S -80"
ssh "$HOST" "pgrep -af 'llama-bench|calibrate-ubatch|run_calibrated_campaign' || true"
ssh "$HOST" "journalctl -u gpu-workload-watch.service -n 6 --no-pager"
```

Completion requires a `campaign.finished` marker and no `campaign.failed`
marker. A missing process is not proof of success.

```bash
REMOTE_RESULTS="/home/kyuz0/llamacpp_toolboxes_bench_results/toolbox_performance_calibrated/$CAMPAIGN_ID/final/$TAG"
ssh "$HOST" "test -f '$REMOTE_RESULTS/campaign.finished' && test ! -e '$REMOTE_RESULTS/campaign.failed'"
```

## 7. Fetch and validate before integration

Run this section and all remaining integration steps on the machine where the
agent is operating, from the root of the local
`amd-strix-halo-toolboxes` checkout. `rsync` fetches the results from `$HOST`
into the local `$STAGE` directory; do not run these commands on `fw1` or `fw2`.

```bash
STAGE="$(mktemp -d)"
rsync -a "$HOST:$REMOTE_RESULTS/" "$STAGE/$TAG/"
python benchmark/toolbox_performance/validate_campaign.py "$STAGE/$TAG"
```

The five-model campaign must validate as:

```text
5 models
90 summary rows
9 starting depths per series
3 samples per point
```

Required files include JSONL and stderr pairs, `curve_summary.csv`,
`campaign_manifest.json`, `campaign.finished`, `run_metadata.txt`, and
`ubatch-calibrations.json`.

Do not integrate partial or failed data.

## 8. Replace one complete tag dataset

Still from the root of the local repository, replace its checked-out dataset
with the validated files in local `$STAGE`. Keep the previous dataset
recoverable:

```bash
BACKUP_ROOT="$(mktemp -d)"
mv "benchmark/toolbox_performance/$TAG" "$BACKUP_ROOT/$TAG"
cp -a "$STAGE/$TAG" "benchmark/toolbox_performance/$TAG"
python benchmark/toolbox_performance/validate_campaign.py \
  "benchmark/toolbox_performance/$TAG"
python benchmark/toolbox_performance/generate_results_json.py
git diff --check
```

Do not delete `$BACKUP_ROOT` until the user accepts the result. If validation or
generation fails, move the replacement aside and restore the backup.

For a model-only addition, copy only that model's JSONL/stderr files and merge
the staged summary instead of replacing unrelated results:

```bash
python benchmark/toolbox_performance/merge_curve_summary.py \
  benchmark/toolbox_performance/$TAG/curve_summary.csv \
  "$STAGE/$TAG/curve_summary.csv"
```

## 9. Regenerate and inspect the viewer dataset

```bash
for directory in benchmark/toolbox_performance/*/; do
  test -f "$directory/curve_summary.csv" || continue
  python benchmark/toolbox_performance/validate_campaign.py "$directory"
done

python benchmark/toolbox_performance/generate_results_json.py
python3 -m json.tool docs/toolbox-performance-results.json >/dev/null
git diff --check
```

Report generator warnings and material curve/calibration changes to the user.
Do not publish without explicit authorization.

## 10. Promote stable calibration into cockpit

Only do this after a complete, valid campaign and when the user wants
the calibrated ubatch alues shipped as cockpit defaults.

Target repository: `llama-toolboxes-cockpit` (ask the user where it is or look for it on disk)

Update the exact matching entry in `src/assets/models.json`:

```json
"benchmark": {
  "preferred_ubatch": {
    "strix-halo": {
      "rocm": 1024,
      "vulkan": 256
    }
  }
}
```

Agent rules:

- Match the exact model catalog entry, including `MTP`.
- Store backend-family values (`rocm`, `vulkan`), not image tags or digests.
- Preserve resolver order: local calibration, shipped default, llama.cpp
  default.
- If two quants under one catalog entry select different values, do not choose
  one silently. Report the conflict; the current schema cannot express it.
- Update the cockpit shipped-default table and
  `tests/test_shipped_defaults.py`.

Validate from the cockpit repository:

```bash
python3 -m json.tool src/assets/models.json >/dev/null
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v
git diff --check
```

## Agent completion report

Report only verified facts:

- host, tag, image digest, cockpit version, and campaign ID
- selected ubatch per exact model
- job/marker status
- validation result and row count
- files or datasets changed
- remaining missing backends/models
- whether anything was committed, pushed, published, or dispatched
