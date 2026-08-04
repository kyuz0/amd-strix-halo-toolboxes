# Toolbox performance curves

This is the operator runbook for reproducing the Strix Halo toolbox comparison.
It is written so a new person or coding agent can start without relying on shell
history or files left in a host's `/tmp` directory.

The image tag is the dataset identity. Keep every backend in its own directory:

```text
benchmark/toolbox_performance/<toolbox-tag>/
```

The experimental performance image uses the tag `vulkan-radv-performance` and
the toolbox name `llama-vulkan-radv-performance`.

## Fixed campaign definition

Do not change these settings within a comparison:

- platform: `strix-halo`
- starting depths: `0,8192,16384,24576,32768,40960,49152,57344,65536`
- prefill: `2048` tokens
- generation: `128` tokens
- batch: `2048`
- repetitions: `3`
- cooldown: `10` seconds
- GPU layers: `99`
- flash attention: enabled
- memory mapping: disabled (`--load-mode none` when supported)
- KV-cache quantization: disabled
- ubatch candidates: `256,512,1024,2048`

The calibration evaluates the complete nine-depth prefill curve, not only depth
zero. Its winning prefill curve is valid benchmark data and can be reused for
the toolbox that produced it. Generation then runs with the same selected
ubatch. Cockpit does not start calibration automatically when a benchmark is
launched: `llama-cockpit-calibrate-ubatch` is a separate, explicit step.

## Hosts and work allocation

Both machines are reached from the workstation with normal SSH:

| SSH host | Canonical work | Toolbox |
| --- | --- | --- |
| `fw1` | ROCm calibration and campaign | `llama-rocm-7.14` |
| `fw2` | Vulkan calibration and performance-fork campaign | `llama-vulkan-radv-performance` |
| `fw2` | Stock Vulkan campaign after the performance run | `llama-vulkan-radv` |

Models live under `/home/kyuz0/models` on both hosts. Campaign output lives
under:

```text
/home/kyuz0/llamacpp_toolboxes_bench_results/toolbox_performance_calibrated/<campaign-id>/
```

Run `fw1` and `fw2` concurrently, but never run two benchmark or calibration
processes on the same host at once. Run stock RADV only after the performance
Vulkan campaign on `fw2` has finished.

## Current four-model campaign

Use these exact paths:

```bash
MODELS=(
  "$HOME/models/Qwen3.6-27B-MTP-GGUF/Qwen3.6-27B-UD-Q8_K_XL.gguf"
  "$HOME/models/Qwen3.6-35B-A3B-MTP-GGUF/Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf"
  "$HOME/models/Qwen3.6-35B-A3B-MTP-GGUF/Qwen3.6-35B-A3B-UD-Q8_K_XL.gguf"
  "$HOME/models/DeepSeek-V4-Flash-0731-GGUF/UD-IQ2_XXS/DeepSeek-V4-Flash-0731-UD-IQ2_XXS-00001-of-00003.gguf"
)
```

The first DeepSeek shard is the model path passed to `llama.cpp`; the other
shards must be present beside it. MTP does not need special benchmark arguments.

## 1. Update cockpit and deploy the campaign helper

From this repository on the workstation:

```bash
for host in fw1 fw2; do
  ssh "$host" 'pipx upgrade llama-cockpit'
  scp benchmark/toolbox_performance/run_calibrated_campaign.py "$host:~/"
done
```

`llama-cockpit` is installed from
`git+https://github.com/kyuz0/llama-toolboxes-cockpit.git`. Verify that the
calibration command exists:

```bash
ssh fw1 'llama-cockpit-calibrate-ubatch --help >/dev/null && pipx list | grep llama-cockpit'
ssh fw2 'llama-cockpit-calibrate-ubatch --help >/dev/null && pipx list | grep llama-cockpit'
```

## 2. Pull and recreate the required toolboxes

Recommended: run `llama-cockpit` interactively on each host, select the required
toolbox, then use **Create/Update**. Updating deletes and recreates that toolbox
container.

The equivalent Toolbx commands are below. They are destructive to the named
container, so use them only when it is safe to recreate it:

```bash
TAG=rocm-7.14                       # fw1
# TAG=vulkan-radv-performance       # fw2 performance fork
# TAG=vulkan-radv                   # fw2 stock RADV
NAME="llama-$TAG"
IMAGE="docker.io/kyuz0/amd-strix-halo-toolboxes:$TAG"

podman pull "$IMAGE"
toolbox rm --force "$NAME"
toolbox create --image "$IMAGE" "$NAME"
```

## 3. Preflight each host

Define `MODELS` with the current four-model block above and set the host's
toolbox before starting a multi-hour campaign:

```bash
# fw1:
TOOLBOX=llama-rocm-7.14

# fw2, one at a time:
# TOOLBOX=llama-vulkan-radv-performance
# TOOLBOX=llama-vulkan-radv

systemctl is-active gpu-workload-watch.service
test -r /sys/class/drm/card1/device/gpu_busy_percent || \
  test -r /sys/class/drm/card0/device/gpu_busy_percent
printf '%s\n' "${MODELS[@]}" | xargs -r -n1 test -f
toolbox run -c "$TOOLBOX" -- llama-bench --list-devices
pgrep -af 'llama-bench|llama-cockpit-calibrate-ubatch|run_calibrated_campaign' || true
```

Required result: the workload watcher is active, every model exists, the GPU is
listed, and no older benchmark process is running. The watcher should switch to
`accelerator-performance` and maximum fans while `llama-bench` is alive, even
when instantaneous GPU utilization is zero, then retain that state for up to 60
seconds after the workload ends.

Use a persistent session because each campaign takes hours:

```bash
ssh -t fw1 'tmux new -As toolbox-benchmark'
ssh -t fw2 'tmux new -As toolbox-benchmark'
```

## 4. Create a fresh campaign

Choose one campaign ID and use it on both hosts. Never reuse an old final-results
directory: the runner refuses to mix campaigns, and cockpit skips non-empty
result files.

Run this setup block in both `tmux` sessions:

```bash
CAMPAIGN_ID="$(date -u +%Y%m%dT%H%M%SZ)-toolbox-performance"
CAMPAIGN_ROOT="$HOME/llamacpp_toolboxes_bench_results/toolbox_performance_calibrated/$CAMPAIGN_ID"
CALIBRATION_ROOT="$CAMPAIGN_ROOT/calibration"
COCKPIT_PY="$HOME/.local/share/pipx/venvs/llama-cockpit/bin/python"
HOST_PROFILE="gpu-workload-watch (accelerator-performance and maximum fans), amd_iommu=off"

MODELS=(
  "$HOME/models/Qwen3.6-27B-MTP-GGUF/Qwen3.6-27B-UD-Q8_K_XL.gguf"
  "$HOME/models/Qwen3.6-35B-A3B-MTP-GGUF/Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf"
  "$HOME/models/Qwen3.6-35B-A3B-MTP-GGUF/Qwen3.6-35B-A3B-UD-Q8_K_XL.gguf"
  "$HOME/models/DeepSeek-V4-Flash-0731-GGUF/UD-IQ2_XXS/DeepSeek-V4-Flash-0731-UD-IQ2_XXS-00001-of-00003.gguf"
)
MODEL_ARGS=()
for model in "${MODELS[@]}"; do MODEL_ARGS+=(--model "$model"); done

mkdir -p "$CALIBRATION_ROOT"
```

Because the setup block is run separately, copy the generated `CAMPAIGN_ID` from
the first host to the second instead of allowing the timestamps to differ.

### fw1: ROCm calibration and campaign

```bash
TOOLBOX=llama-rocm-7.14

for model in "${MODELS[@]}"; do
  llama-cockpit-calibrate-ubatch \
    --toolbox "$TOOLBOX" \
    --model "$model" \
    --results-dir "$CALIBRATION_ROOT"
done

"$COCKPIT_PY" "$HOME/run_calibrated_campaign.py" \
  --campaign-id "$CAMPAIGN_ID" \
  --host-label fw1 \
  --host-profile "$HOST_PROFILE" \
  --toolbox "$TOOLBOX" \
  --results-dir "$CAMPAIGN_ROOT/final/rocm-7.14" \
  --reuse-calibration \
  "${MODEL_ARGS[@]}"
```

### fw2: performance Vulkan calibration and campaign

```bash
TOOLBOX=llama-vulkan-radv-performance

for model in "${MODELS[@]}"; do
  llama-cockpit-calibrate-ubatch \
    --toolbox "$TOOLBOX" \
    --model "$model" \
    --results-dir "$CALIBRATION_ROOT"
done

"$COCKPIT_PY" "$HOME/run_calibrated_campaign.py" \
  --campaign-id "$CAMPAIGN_ID" \
  --host-label fw2 \
  --host-profile "$HOST_PROFILE" \
  --toolbox "$TOOLBOX" \
  --results-dir "$CAMPAIGN_ROOT/final/vulkan-radv-performance" \
  --reuse-calibration \
  "${MODEL_ARGS[@]}"
```

### fw2: stock RADV campaign

Run only after the performance campaign has finished:

```bash
TOOLBOX=llama-vulkan-radv

"$COCKPIT_PY" "$HOME/run_calibrated_campaign.py" \
  --campaign-id "$CAMPAIGN_ID" \
  --host-label fw2 \
  --host-profile "$HOST_PROFILE" \
  --toolbox "$TOOLBOX" \
  --results-dir "$CAMPAIGN_ROOT/final/vulkan-radv" \
  "${MODEL_ARGS[@]}"
```

Do not pass `--reuse-calibration` for stock RADV: its Vulkan ubatch selections
come from the saved backend calibration, but reusing the performance fork's raw
prefill curve would contaminate the stock results. Stock RADV must run both its
own prefill and generation curves.

Calibration is intentionally keyed by platform, backend family, and exact model
filename—not image digest or toolbox tag. Therefore ROCm and Vulkan may use
different ubatches, while both Vulkan toolboxes use the same selected Vulkan
ubatch for a fair comparison.

## 5. Monitor without disturbing the run

Attach to the persistent session only when needed:

```bash
ssh -t fw1 'tmux attach -t toolbox-benchmark'
ssh -t fw2 'tmux attach -t toolbox-benchmark'
```

For a lightweight health check from another terminal:

```bash
ssh fw1 'pgrep -af "llama-bench|calibrate-ubatch|run_calibrated_campaign"; systemctl is-active gpu-workload-watch.service; journalctl -u gpu-workload-watch.service -n 4 --no-pager'
ssh fw2 'pgrep -af "llama-bench|calibrate-ubatch|run_calibrated_campaign"; systemctl is-active gpu-workload-watch.service; journalctl -u gpu-workload-watch.service -n 4 --no-pager'
```

There is no need to poll every few minutes. Check after the expected multi-hour
window or attach to `tmux` when an explicit progress check is required.

## 6. Required output and validation

Each final tag directory must contain:

- two JSONL files and two stderr logs per model (prefill and generation)
- `curve_summary.csv`
- `campaign_manifest.json`
- `campaign.finished` and no `campaign.failed`
- `run_metadata.txt`
- `ubatch-calibrations.json`

For four models, the summary must contain 72 data rows: four models, two series,
and nine depths. Every point must contain three timing samples. The checked-in
runner writes `campaign.finished` only when the expected row count is complete
and no job returned `failed`.

Fetch into a temporary staging directory on the workstation and validate before
touching the repository dataset:

```bash
STAGE="$(mktemp -d)"
CAMPAIGN_ID=<the-shared-campaign-id>

rsync -a "fw1:/home/kyuz0/llamacpp_toolboxes_bench_results/toolbox_performance_calibrated/$CAMPAIGN_ID/final/rocm-7.14/" "$STAGE/rocm-7.14/"
rsync -a "fw2:/home/kyuz0/llamacpp_toolboxes_bench_results/toolbox_performance_calibrated/$CAMPAIGN_ID/final/vulkan-radv-performance/" "$STAGE/vulkan-radv-performance/"
rsync -a "fw2:/home/kyuz0/llamacpp_toolboxes_bench_results/toolbox_performance_calibrated/$CAMPAIGN_ID/final/vulkan-radv/" "$STAGE/vulkan-radv/"

for tag in rocm-7.14 vulkan-radv-performance vulkan-radv; do
  python benchmark/toolbox_performance/validate_campaign.py "$STAGE/$tag"
done
```

If a campaign is partial or failed, preserve it for diagnosis but do not merge
it into the published dataset. Rerun only that model/toolbox into a fresh output
directory.

## 7. Replace or extend repository data

For a complete replacement, keep the old directory as a recoverable backup
until generation succeeds, then copy the validated staged directory into:

```text
benchmark/toolbox_performance/<toolbox-tag>/
```

From the repository root, replace one tag at a time:

```bash
TAG=rocm-7.14
# TAG=vulkan-radv-performance
# TAG=vulkan-radv

BACKUP_ROOT="$(mktemp -d)"
mv "benchmark/toolbox_performance/$TAG" "$BACKUP_ROOT/$TAG"
cp -a "$STAGE/$TAG" "benchmark/toolbox_performance/$TAG"
python benchmark/toolbox_performance/validate_campaign.py \
  "benchmark/toolbox_performance/$TAG"
python benchmark/toolbox_performance/generate_results_json.py
```

Keep `$BACKUP_ROOT` until the validator, generator, diff review, and rendered
page all pass. If validation fails, move the new directory aside and restore
`$BACKUP_ROOT/$TAG`.

For one new model added to an otherwise valid existing toolbox directory, copy
only its new JSONL and stderr files, then merge the summary explicitly:

```bash
python benchmark/toolbox_performance/merge_curve_summary.py \
  benchmark/toolbox_performance/<toolbox-tag>/curve_summary.csv \
  /path/to/new/curve_summary.csv
```

The merge refuses conflicting rows with the same model, toolbox, series, and
starting depth. Never overwrite an existing `curve_summary.csv` merely to add
one model.

## 8. Promote stable calibration defaults into llama-cockpit

The per-host file
`~/.config/llama-cockpit/ubatch-calibrations.json` contains full raw calibration
history. It is archived with each campaign, but it is not the shipped cockpit
configuration.

After a clean, thermally valid campaign, promote only each selected integer into
the matching model entry in:

```text
~/Documents/Projects/llama-toolboxes-cockpit/src/assets/models.json
```

The shape is:

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

Rules:

- update the exact catalog entry that matches the model directory, including
  `MTP` when applicable; do not update a similarly named non-MTP entry
- store one value per backend family (`rocm` or `vulkan`), not per image digest
  or toolbox tag
- if separately calibrated quants under one catalog entry select different
  values, do not silently pick one: retain their local exact-file calibrations
  until the cockpit schema can represent quant-specific shipped defaults
- keep resolver precedence: local calibration, then shipped model default, then
  the llama.cpp default
- update the shipped-default table in the cockpit `README.md`
- update `tests/test_shipped_defaults.py` with the real model path and values

Validate the cockpit change from its repository root:

```bash
python3 -m json.tool src/assets/models.json >/dev/null
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v
git diff --check
```

Only publish the cockpit update after reviewing the calibration curves and
confirming there were no cooling, throttling, crash, or incomplete-depth issues.

## 9. Regenerate the comparison page

Every subdirectory containing `curve_summary.csv` is discovered automatically.
From the root of this repository run:

```bash
for tag in benchmark/toolbox_performance/*/; do
  test -f "$tag/curve_summary.csv" || continue
  python benchmark/toolbox_performance/validate_campaign.py "$tag"
done

python benchmark/toolbox_performance/generate_results_json.py
git diff --check
```

This writes `docs/toolbox-performance-results.json`, displayed by
`docs/toolbox-performance.html`. Review generator warnings, the metadata shown
in the page, the calibrated ubatches, and both prefill and generation curves
before committing or publishing anything.

## Adding a model or rerunning after an image update

For a new model:

1. Put the complete GGUF (all shards) under the same path on both hosts.
2. Add its exact path to `MODELS`.
3. Calibrate it once for ROCm on `fw1` and once for Vulkan on `fw2`.
4. Run it through each toolbox with the fixed campaign settings.
5. Validate and merge its rows instead of replacing unrelated model data.
6. Promote the selected backend defaults into cockpit only after review.

After rebuilding an image, create a new campaign ID, pull/recreate only the
affected toolbox, and rerun all comparison models for that tag. Do not key
calibration by the new digest and do not mix old and new image results in one
tag directory. The archived `run_metadata.txt` records which digest and
llama.cpp build produced each published dataset.
