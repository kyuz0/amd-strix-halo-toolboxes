#!/usr/bin/env python3
"""Generate the standalone toolbox performance comparison dataset."""

from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_OUTPUT = SCRIPT_DIR.parents[1] / "docs" / "toolbox-performance-results.json"

TOOLBOX_PRESENTATION = {
    "vulkan-radv": {
        "label": "Vulkan RADV (stock)",
        "description": "Upstream llama.cpp with the stock RADV toolbox",
    },
    "vulkan-radv-performance": {
        "label": "Vulkan RADV Performance",
        "description": "Strix Halo Vulkan performance fork",
    },
    "rocm-7.2.4": {
        "label": "ROCm 7.2.4 (legacy)",
        "description": "Legacy ROCm 7.2.4 toolbox retained for performance comparison",
    },
    "rocm-7.14": {
        "label": "ROCm 7.14",
        "description": "Upstream llama.cpp with the ROCm 7.14 toolbox",
    },
}
PREFERRED_ORDER = (
    "vulkan-radv",
    "vulkan-radv-performance",
    "rocm-7.2.4",
    "rocm-7.14",
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
BUILD_RE = re.compile(r"(?P<number>\d+)\s+\((?P<hash>[0-9a-f]+)\)", re.IGNORECASE)


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


def parse_run_metadata(path: Path) -> dict[str, str]:
    if not path.is_file():
        return {}
    metadata = {}
    for line_number, raw_line in enumerate(path.read_text().splitlines(), start=1):
        line = raw_line.strip()
        if not line:
            continue
        if ":" not in line:
            raise ValueError(f"Invalid metadata line in {path}:{line_number}")
        key, value = line.split(":", 1)
        metadata[key.strip()] = value.strip()
    return metadata


def read_jsonl_metadata(toolbox_dir: Path) -> dict:
    for path in sorted(toolbox_dir.glob("*.jsonl")):
        with path.open() as handle:
            for line in handle:
                if line.strip():
                    row = json.loads(line)
                    return {
                        "build_number": row.get("build_number"),
                        "cpu_info": row.get("cpu_info"),
                    }
    return {}


def parse_summary(source: Path, toolbox_id: str) -> list[dict]:
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
                "toolbox": toolbox_id,
                "toolbox_name": row["toolbox"].strip(),
                "model": model,
                "model_source": raw_model,
                "quant": quant_match.group(1).upper() if quant_match else None,
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
            expected_end = (
                point["starting_depth"]
                + point["prompt_tokens"]
                + point["generation_tokens"]
            )
            if point["ending_context"] != expected_end:
                raise ValueError(
                    f"ending_context mismatch in {source}:{line}: "
                    f"expected {expected_end}, got {point['ending_context']}"
                )
            if not samples:
                raise ValueError(f"No samples in {source}:{line}")
            points.append(point)
    return points


def pretty_label(toolbox_id: str) -> str:
    words = toolbox_id.replace("-", " ").split()
    replacements = {"radv": "RADV", "rocm": "ROCm", "vulkan": "Vulkan"}
    return " ".join(replacements.get(word.lower(), word.title()) for word in words)


def toolbox_sort_key(path: Path) -> tuple[int, str]:
    try:
        return (PREFERRED_ORDER.index(path.name), path.name)
    except ValueError:
        return (len(PREFERRED_ORDER), path.name)


def build_toolbox_metadata(toolbox_dir: Path, points: list[dict]) -> dict:
    run = parse_run_metadata(toolbox_dir / "run_metadata.txt")
    raw = read_jsonl_metadata(toolbox_dir)
    presentation = TOOLBOX_PRESENTATION.get(toolbox_dir.name, {})
    result_statuses = {}
    for key, value in run.items():
        if not key.endswith(" status"):
            continue
        model = key.removesuffix(" status").removesuffix(".gguf")
        result_statuses[SHARD_RE.sub("", model)] = value
    builds = sorted({point["build_commit"] for point in points if point["build_commit"]})
    toolbox_names = sorted({point["toolbox_name"] for point in points})
    gpu_names = sorted({point["gpu_info"] for point in points if point["gpu_info"]})
    build_match = BUILD_RE.search(run.get("llama_build", ""))
    build_number = raw.get("build_number")
    if build_number is None and build_match:
        build_number = int(build_match.group("number"))
    return {
        "id": toolbox_dir.name,
        "label": presentation.get("label", pretty_label(toolbox_dir.name)),
        "description": presentation.get(
            "description", f"Toolbox image tag {toolbox_dir.name}"
        ),
        "toolbox_name": run.get("toolbox") or (toolbox_names[0] if toolbox_names else None),
        "image": run.get("image"),
        "image_digest": run.get("image_digest"),
        "host": run.get("host"),
        "host_profile": run.get("host_profile"),
        "kernel": run.get("kernel"),
        "builds": [
            {"hash": build, "number": build_number if len(builds) == 1 else None}
            for build in builds
        ],
        "gpu_names": gpu_names,
        "cpu_info": raw.get("cpu_info"),
        "result_statuses": result_statuses,
    }


def validate(points: list[dict], toolboxes: list[dict]) -> list[str]:
    keys = [
        (point["toolbox"], point["model"], point["series"], point["starting_depth"])
        for point in points
    ]
    if len(keys) != len(set(keys)):
        raise ValueError("Duplicate toolbox/model/series/depth results found")

    warnings = []
    all_models = {point["model"] for point in points}
    for toolbox in toolboxes:
        toolbox_points = [point for point in points if point["toolbox"] == toolbox["id"]]
        names = {point["toolbox_name"] for point in toolbox_points}
        if len(names) != 1:
            warnings.append(f"{toolbox['label']}: multiple toolbox names in one dataset")
        models = {point["model"] for point in toolbox_points}
        missing_models = sorted(all_models - models)
        if missing_models:
            warnings.append(
                f"{toolbox['label']}: missing models: {', '.join(missing_models)}"
            )
        for model in sorted(models):
            series_depths = {
                series: {
                    point["starting_depth"]
                    for point in toolbox_points
                    if point["model"] == model and point["series"] == series
                }
                for series in ("prefill", "generation")
            }
            if series_depths["prefill"] != series_depths["generation"]:
                warnings.append(
                    f"{toolbox['label']} / {model}: prefill and generation depths differ"
                )

    for model in sorted(all_models):
        model_points = [point for point in points if point["model"] == model]
        configurations = {
            (
                point["series"],
                point["prompt_tokens"],
                point["generation_tokens"],
                point["batch"],
                len(point["samples"]),
            )
            for point in model_points
        }
        for series in ("prefill", "generation"):
            series_configurations = {
                configuration for configuration in configurations if configuration[0] == series
            }
            if len(series_configurations) > 1:
                warnings.append(
                    f"{model} / {series}: non-ubatch benchmark settings differ by toolbox"
                )

        depth_sets_by_series = {
            series: {
                point["toolbox"]: tuple(
                    sorted(
                        candidate["starting_depth"]
                        for candidate in model_points
                        if candidate["toolbox"] == point["toolbox"]
                        and candidate["series"] == series
                    )
                )
                for point in model_points
                if point["series"] == series
            }
            for series in ("prefill", "generation")
        }
        if any(
            len(set(depth_sets.values())) > 1
            for depth_sets in depth_sets_by_series.values()
        ):
            maximum_counts = {
                series: max((len(depths) for depths in depth_sets.values()), default=0)
                for series, depth_sets in depth_sets_by_series.items()
            }
            for toolbox in toolboxes:
                toolbox_id = toolbox["id"]
                is_partial = any(
                    len(depth_sets_by_series[series].get(toolbox_id, ()))
                    < maximum_counts[series]
                    for series in ("prefill", "generation")
                )
                if not is_partial:
                    continue
                status = toolbox.get("result_statuses", {}).get(model)
                if status and status.lower() != "complete":
                    warnings.append(f"{toolbox['label']} / {model}: {status}")
                    continue
                available = sorted(
                    set(depth_sets_by_series["prefill"].get(toolbox_id, ()))
                    | set(depth_sets_by_series["generation"].get(toolbox_id, ()))
                )
                depth_text = ", ".join(f"{depth:,}" for depth in available) or "none"
                warnings.append(
                    f"{toolbox['label']} / {model}: partial results; "
                    f"available starting depths: {depth_text}"
                )
    return warnings


def main() -> None:
    args = parse_args()
    points = []
    toolboxes = []
    directories = sorted(
        (
            path
            for path in SCRIPT_DIR.iterdir()
            if path.is_dir() and (path / "curve_summary.csv").is_file()
        ),
        key=toolbox_sort_key,
    )
    if not directories:
        raise FileNotFoundError(f"No toolbox curve_summary.csv files found under {SCRIPT_DIR}")

    for toolbox_dir in directories:
        toolbox_points = parse_summary(toolbox_dir / "curve_summary.csv", toolbox_dir.name)
        points.extend(toolbox_points)
        toolboxes.append(build_toolbox_metadata(toolbox_dir, toolbox_points))

    warnings = validate(points, toolboxes)
    models = sorted({point["model"] for point in points})
    depths = sorted({point["starting_depth"] for point in points})
    cpu_names = sorted(
        {toolbox["cpu_info"] for toolbox in toolboxes if toolbox.get("cpu_info")}
    )
    host_profiles = sorted(
        {toolbox["host_profile"] for toolbox in toolboxes if toolbox.get("host_profile")}
    )
    default_toolbox = "vulkan-radv" if "vulkan-radv" in {item["id"] for item in toolboxes} else toolboxes[0]["id"]

    output = {
        "meta": {
            "title": "Strix Halo toolbox performance comparison",
            "cpu_info": cpu_names[0] if len(cpu_names) == 1 else None,
            "system_memory_gb": 128,
            "host_profiles": host_profiles,
            "default_toolbox": default_toolbox,
            "toolboxes": toolboxes,
            "depths": depths,
            "warnings": warnings,
        },
        "models": models,
        "points": sorted(
            points,
            key=lambda point: (
                point["model"],
                point["series"],
                point["toolbox"],
                point["starting_depth"],
            ),
        ),
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2) + "\n")
    print(
        f"Wrote {args.output} with {len(points)} points across "
        f"{len(models)} models and {len(toolboxes)} toolboxes"
    )
    for warning in warnings:
        print(f"Warning: {warning}")


if __name__ == "__main__":
    main()
