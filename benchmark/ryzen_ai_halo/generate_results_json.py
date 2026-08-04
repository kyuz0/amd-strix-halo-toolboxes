#!/usr/bin/env python3
"""Generate the standalone Ryzen AI Halo depth-curve dataset."""

from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_OUTPUT = SCRIPT_DIR.parents[1] / "docs" / "ryzen-ai-halo-results.json"

# A profile is included when its directory contains curve_summary.csv. This makes
# the generator useful while profiles are still being benchmarked: copy a new
# completed directory into this folder and rerun this script.
PROFILE_DEFINITIONS = (
    {
        "id": "default",
        "label": "Default",
        "description": "Out-of-box system profile",
        "directory": "llamacpp_toolboxes_bench_results-default-profile",
    },
    {
        "id": "performance-no-iommu",
        "label": "Performance + IOMMU off",
        "description": "tuned performance profile with amd_iommu disabled",
        # Keep the source directory's original spelling for reproducibility.
        "directory": "llamacpp_toolboxes_bench_results-profile_perfromance_iommu-off",
    },
)

REQUIRED_COLUMNS = {
    "model",
    "toolbox",
    "series",
    "starting_depth",
    "ending_context",
    "n_prompt",
    "n_gen",
    "n_batch",
    "n_ubatch",
    "avg_ts",
    "stddev_ts",
    "samples_ts",
    "build_commit",
    "gpu_info",
}

SHARD_RE = re.compile(r"-000\d+-of-000\d+", re.IGNORECASE)
QUANT_RE = re.compile(r"(Q\d+_[A-Z0-9_]+|BF16|F16|F32)", re.IGNORECASE)
DEVICE_RE = re.compile(r"Device\s+0:\s*([^,]+),\s*(gfx\d+)", re.IGNORECASE)
VRAM_RE = re.compile(r"Total VRAM:\s*(\d+)\s*MiB", re.IGNORECASE)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Output JSON path (default: {DEFAULT_OUTPUT})",
    )
    return parser.parse_args()


def parse_int(row: dict[str, str], key: str, source: Path, line: int) -> int:
    try:
        return int(row[key])
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError(f"Invalid {key!r} in {source}:{line}") from error


def parse_float(row: dict[str, str], key: str, source: Path, line: int) -> float:
    try:
        return float(row[key])
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError(f"Invalid {key!r} in {source}:{line}") from error


def parse_summary(source: Path, profile_id: str) -> list[dict]:
    points = []
    with source.open(newline="") as handle:
        reader = csv.DictReader(handle)
        missing = REQUIRED_COLUMNS - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"{source} is missing columns: {', '.join(sorted(missing))}")

        for line, row in enumerate(reader, start=2):
            series = row["series"].strip().lower()
            if series not in {"prefill", "generation"}:
                raise ValueError(f"Unknown series {series!r} in {source}:{line}")

            raw_model = row["model"].strip()
            model = SHARD_RE.sub("", raw_model)
            quant_match = QUANT_RE.search(model)
            try:
                samples = [float(value) for value in json.loads(row["samples_ts"])]
            except (json.JSONDecodeError, TypeError, ValueError) as error:
                raise ValueError(f"Invalid samples_ts in {source}:{line}") from error

            point = {
                "profile": profile_id,
                "model": model,
                "model_source": raw_model,
                "quant": quant_match.group(1).upper() if quant_match else None,
                "toolbox": row["toolbox"].strip(),
                "series": series,
                "starting_depth": parse_int(row, "starting_depth", source, line),
                "ending_context": parse_int(row, "ending_context", source, line),
                "prompt_tokens": parse_int(row, "n_prompt", source, line),
                "generation_tokens": parse_int(row, "n_gen", source, line),
                "batch": parse_int(row, "n_batch", source, line),
                "ubatch": parse_int(row, "n_ubatch", source, line),
                "mean": parse_float(row, "avg_ts", source, line),
                "stddev": parse_float(row, "stddev_ts", source, line),
                "samples": samples,
                "build_commit": row["build_commit"].strip(),
                "gpu_info": row["gpu_info"].strip(),
            }
            expected_end = point["starting_depth"] + point["prompt_tokens"] + point["generation_tokens"]
            if point["ending_context"] != expected_end:
                raise ValueError(
                    f"ending_context mismatch in {source}:{line}: "
                    f"expected {expected_end}, got {point['ending_context']}"
                )
            if not samples:
                raise ValueError(f"No samples in {source}:{line}")
            points.append(point)
    return points


def read_jsonl_metadata(profile_dir: Path) -> dict:
    for path in sorted(profile_dir.glob("*.jsonl")):
        with path.open() as handle:
            for line in handle:
                if line.strip():
                    row = json.loads(line)
                    return {
                        "build_number": row.get("build_number"),
                        "cpu_info": row.get("cpu_info"),
                    }
    return {}


def read_device_metadata(profile_dir: Path) -> dict:
    for path in sorted(profile_dir.glob("*.stderr.log")):
        text = path.read_text(errors="ignore")
        device = DEVICE_RE.search(text)
        vram = VRAM_RE.search(text)
        if device or vram:
            return {
                "device": device.group(1) if device else None,
                "architecture": device.group(2) if device else None,
                "vram_mib": int(vram.group(1)) if vram else None,
            }
    return {}


def validate(points: list[dict], profiles: list[dict]) -> list[str]:
    keys = [
        (point["profile"], point["model"], point["series"], point["starting_depth"])
        for point in points
    ]
    if len(keys) != len(set(keys)):
        raise ValueError("Duplicate profile/model/series/depth results found")

    warnings = []
    all_models = {point["model"] for point in points}
    for profile in profiles:
        profile_points = [point for point in points if point["profile"] == profile["id"]]
        models = sorted({point["model"] for point in profile_points})
        missing_models = sorted(all_models - set(models))
        if missing_models:
            warnings.append(
                f"{profile['label']}: missing models: {', '.join(missing_models)}"
            )
        for model in models:
            prefill = {
                point["starting_depth"]
                for point in profile_points
                if point["model"] == model and point["series"] == "prefill"
            }
            generation = {
                point["starting_depth"]
                for point in profile_points
                if point["model"] == model and point["series"] == "generation"
            }
            if prefill != generation:
                warnings.append(
                    f"{profile['label']} / {model}: prefill and generation depth sets differ"
                )

    for model in sorted(all_models):
        model_points = [point for point in points if point["model"] == model]
        configurations = {
            (point["toolbox"], point["batch"], point["ubatch"])
            for point in model_points
        }
        if len(configurations) > 1:
            warnings.append(f"{model}: toolbox/batch/ubatch differs between profiles")
        for series in ("prefill", "generation"):
            depth_sets = {
                point["profile"]: {
                    candidate["starting_depth"]
                    for candidate in model_points
                    if candidate["profile"] == point["profile"] and candidate["series"] == series
                }
                for point in model_points
                if point["series"] == series
            }
            if len({tuple(sorted(depths)) for depths in depth_sets.values()}) > 1:
                warnings.append(f"{model} / {series}: depth sets differ between profiles")
    return warnings


def main() -> None:
    args = parse_args()
    points = []
    profiles = []
    metadata = {}

    for definition in PROFILE_DEFINITIONS:
        profile_dir = SCRIPT_DIR / definition["directory"]
        summary = profile_dir / "curve_summary.csv"
        if not summary.is_file():
            continue
        profile = {key: value for key, value in definition.items() if key != "directory"}
        profiles.append(profile)
        points.extend(parse_summary(summary, profile["id"]))
        if not metadata:
            metadata.update(read_jsonl_metadata(profile_dir))
            metadata.update(read_device_metadata(profile_dir))

    if not profiles:
        expected = ", ".join(definition["directory"] for definition in PROFILE_DEFINITIONS)
        raise FileNotFoundError(f"No curve_summary.csv found in any profile directory: {expected}")

    warnings = validate(points, profiles)
    models = sorted({point["model"] for point in points})
    builds = sorted({point["build_commit"] for point in points if point["build_commit"]})
    gpu_names = sorted({point["gpu_info"] for point in points if point["gpu_info"]})
    depths = sorted({point["starting_depth"] for point in points})
    if len(builds) > 1:
        warnings.append(f"Multiple llama.cpp builds found: {', '.join(builds)}")
    if len(gpu_names) > 1:
        warnings.append(f"Multiple GPU names found: {', '.join(gpu_names)}")

    output = {
        "meta": {
            "title": "Ryzen AI Halo depth-curve comparison",
            "device": metadata.get("device") or (gpu_names[0] if gpu_names else "AMD Radeon 8060S Graphics"),
            "architecture": metadata.get("architecture") or "gfx1151",
            "system_memory_gb": 128,
            "vram_mib": metadata.get("vram_mib"),
            "cpu_info": metadata.get("cpu_info"),
            "builds": [
                {"hash": build, "number": metadata.get("build_number")}
                for build in builds
            ],
            "profiles": profiles,
            "depths": depths,
            "warnings": warnings,
        },
        "models": models,
        "points": sorted(
            points,
            key=lambda point: (
                point["model"],
                point["series"],
                point["profile"],
                point["starting_depth"],
            ),
        ),
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2) + "\n")
    profile_word = "profile" if len(profiles) == 1 else "profiles"
    print(
        f"Wrote {args.output} with {len(points)} points across "
        f"{len(models)} models and {len(profiles)} {profile_word}"
    )
    for warning in warnings:
        print(f"Warning: {warning}")


if __name__ == "__main__":
    main()
