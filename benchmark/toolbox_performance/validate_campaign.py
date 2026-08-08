#!/usr/bin/env python3
"""Validate one imported toolbox-performance campaign directory."""

from __future__ import annotations

import argparse
import csv
import json
import re
from collections import defaultdict
from pathlib import Path


DEPTHS = tuple(range(0, 65537, 8192))
SHARD_RE = re.compile(r"-\d{5}-of-\d{5}$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("campaign_dir", type=Path)
    return parser.parse_args()


def main() -> None:
    directory = parse_args().campaign_dir
    summary = directory / "curve_summary.csv"
    manifest_path = directory / "campaign_manifest.json"
    required = (
        summary,
        manifest_path,
        directory / "run_metadata.txt",
        directory / "ubatch-calibrations.json",
        directory / "campaign.finished",
    )
    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        raise SystemExit("Missing required campaign files: " + ", ".join(missing))
    if (directory / "campaign.failed").exists():
        raise SystemExit(f"Failure marker exists: {directory / 'campaign.failed'}")

    with summary.open(newline="", encoding="utf-8") as source:
        rows = list(csv.DictReader(source))
    groups: dict[tuple[str, str], list[dict[str, str]]] = defaultdict(list)
    ubatches: dict[str, set[int]] = defaultdict(set)
    for row in rows:
        if row["series"] not in {"prefill", "generation"}:
            raise SystemExit(f"Unknown series: {row['series']}")
        groups[(row["model"], row["series"])].append(row)
        ubatch = int(row["n_ubatch"])
        if ubatch <= 0:
            raise SystemExit(f"Invalid ubatch for {row['model']}: {ubatch}")
        ubatches[row["model"]].add(ubatch)
        if float(row["avg_ts"]) <= 0:
            raise SystemExit(
                f"Non-positive throughput for {row['model']} {row['series']}"
            )
        samples = json.loads(row["samples_ts"])
        if len(samples) != 3:
            raise SystemExit(
                f"Expected 3 samples for {row['model']} {row['series']} "
                f"depth {row['starting_depth']}; got {len(samples)}"
            )
        expected_prompt, expected_generation = (
            (2048, 0) if row["series"] == "prefill" else (0, 128)
        )
        settings = (int(row["n_prompt"]), int(row["n_gen"]), int(row["n_batch"]))
        if settings != (expected_prompt, expected_generation, 2048):
            raise SystemExit(
                f"Unexpected settings for {row['model']} "
                f"{row['series']}: {settings}"
            )

    models = sorted({model for model, _ in groups})
    for model in models:
        for series in ("prefill", "generation"):
            depths = tuple(
                sorted(int(row["starting_depth"]) for row in groups[(model, series)])
            )
            if depths != DEPTHS:
                raise SystemExit(f"Incomplete depth curve for {model} {series}: {depths}")
        if len(ubatches[model]) != 1:
            raise SystemExit(
                f"Ubatch changes within curves for {model}: "
                f"{sorted(ubatches[model])}"
            )

    expected_rows = len(models) * 2 * len(DEPTHS)
    jsonl_files = sorted(directory.glob("*.jsonl"))
    if len(jsonl_files) != len(models) * 2:
        raise SystemExit(
            f"Expected {len(models) * 2} JSONL files; got {len(jsonl_files)}"
        )
    missing_logs = [
        str(path.with_suffix(".stderr.log"))
        for path in jsonl_files
        if not path.with_suffix(".stderr.log").is_file()
    ]
    if missing_logs:
        raise SystemExit("Missing stderr logs: " + ", ".join(missing_logs))

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if len(rows) != expected_rows:
        raise SystemExit(f"Expected {expected_rows} summary rows; got {len(rows)}")
    if manifest.get("complete") is False:
        raise SystemExit("campaign_manifest.json marks this campaign incomplete")
    if int(manifest.get("summary_rows", -1)) != len(rows):
        raise SystemExit("Manifest summary_rows does not match curve_summary.csv")
    failed = [
        item
        for item in manifest.get("statuses", [])
        if item.get("status") == "failed"
    ]
    if failed:
        raise SystemExit(f"Manifest contains {len(failed)} failed job(s)")
    selected = manifest.get("selected_ubatches", {})
    for model in models:
        key = SHARD_RE.sub("", model)
        if selected.get(key) != next(iter(ubatches[model])):
            raise SystemExit(f"Manifest ubatch does not match curves for {model}")

    print(
        f"Validated {directory}: {len(models)} models, {len(rows)} rows, "
        "9 depths and 3 samples per curve point"
    )


if __name__ == "__main__":
    main()
