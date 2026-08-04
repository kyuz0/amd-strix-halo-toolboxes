# Toolbox performance curves

Keep each backend in a directory named after its image tag. Do not mix runs:

```text
toolbox_performance/<toolbox-tag>/
```

## Run recipe

1. On the benchmark host, pull/recreate the toolbox and verify `llama-bench --list-devices`.
2. Calibrate each exact model/backend pair with `llama-cockpit-calibrate-ubatch`. The command tests ubatches `256`, `512`, `1024`, and `2048` across the standard nine-depth prefill curve and saves the winner in `~/.config/llama-cockpit/ubatch-calibrations.json`.
3. Keep comparison settings fixed: depths `0..65536` by `8192`, prefill `2048`, generation `128`, repetitions `3`, cooldown `10`, FA on, mmap off, and no KV quantization.
4. Run the benchmark with the saved backend-specific ubatch. The winning calibration curve is already the final prefill curve; reuse it and run generation once with the same selected ubatch.
5. Copy the fresh JSONL, stderr logs, `curve_summary.csv`, `campaign_manifest.json`, and calibration profile back into the tag directory. Validate nine depths, three samples per point, and 72 summary rows for the four-model campaign.

For another backend, change only the toolbox/tag and use a new output directory. To add a model, calibrate its exact filename first and then add that path to the benchmark job list. Calibrated ubatches may intentionally differ by backend and are displayed separately in the comparison page. Cockpit skips existing non-empty result files, so rerun into a fresh directory or remove only the specific failed/obsolete curve first.

## Regenerate the comparison page

Every subdirectory containing `curve_summary.csv` is discovered automatically. After adding or replacing benchmark data, run from the repository root:

```bash
python benchmark/toolbox_performance/generate_results_json.py
```

This validates the comparable settings and writes `docs/toolbox-performance-results.json`, which is displayed by `docs/toolbox-performance.html`. Use `--output PATH` only for validation or alternate exports.

When adding model results to an existing toolbox directory, copy the new JSONL and stderr files without replacing `curve_summary.csv`, then merge the staged summary explicitly:

```bash
python benchmark/toolbox_performance/merge_curve_summary.py \
  benchmark/toolbox_performance/<toolbox-tag>/curve_summary.csv \
  /path/to/new/curve_summary.csv
```

The merge refuses conflicting rows with the same model, toolbox, series, and starting depth.
