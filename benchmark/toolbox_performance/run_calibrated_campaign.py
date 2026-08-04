#!/usr/bin/env python3
"""Run one toolbox campaign using cockpit's saved ubatch calibration."""

from __future__ import annotations

import argparse
import json
import platform
import shutil
import subprocess
import time
from datetime import datetime, timezone
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

from src.benchmark_runner import (
    BenchmarkSettings,
    build_benchmark_jobs,
    run_benchmark_job,
    write_curve_summary,
)
from src.model_manager import resolve_model_path
from src.toolbox_manager import get_os_toolbox_cmd
from src.ubatch_calibration import DEFAULT_DEPTHS, toolbox_supports_load_mode
from src.ubatch_profiles import (
    DEFAULT_PROFILE_PATH,
    backend_from_name,
    load_profiles,
    model_key,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--toolbox", required=True)
    parser.add_argument("--results-dir", required=True, type=Path)
    parser.add_argument("--model", action="append", required=True)
    parser.add_argument("--campaign-id", required=True)
    parser.add_argument("--host-label", required=True, help="SSH alias, e.g. fw1")
    parser.add_argument("--host-profile", required=True)
    parser.add_argument("--platform", default="strix-halo")
    parser.add_argument("--reuse-calibration", action="store_true")
    parser.add_argument("--cooldown", type=int, default=10)
    return parser.parse_args()


def selected_candidate(
    model_path: str, platform_id: str, backend: str
) -> tuple[int, dict]:
    profile = (
        load_profiles()["profiles"]
        .get(platform_id, {})
        .get(backend, {})
        .get(model_key(model_path), {})
    )
    selected = profile.get("selected_ubatch")
    latest = profile.get("latest_run", {})
    candidate = next(
        (
            item
            for item in latest.get("candidates", [])
            if item.get("ubatch") == selected and item.get("complete")
        ),
        None,
    )
    if not isinstance(selected, int) or candidate is None:
        raise RuntimeError(
            f"No complete current calibration for {model_key(model_path)}"
        )
    return selected, candidate


def validate_calibration_prefill(path: Path, selected: int) -> None:
    rows = [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if tuple(row.get("n_depth") for row in rows) != DEFAULT_DEPTHS:
        raise RuntimeError(f"Calibration depths are incomplete: {path}")
    if any(row.get("n_ubatch") != selected for row in rows):
        raise RuntimeError(f"Calibration ubatch differs from selected value: {path}")
    if any(len(row.get("samples_ts", [])) != 3 for row in rows):
        raise RuntimeError(f"Calibration repetitions are incomplete: {path}")


def command_output(command: list[str]) -> str:
    try:
        result = subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return ""
    return result.stdout.strip()


def first_result_record(results_dir: Path) -> dict:
    for path in sorted(results_dir.glob("*.jsonl")):
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                return json.loads(line)
    return {}


def write_run_metadata(
    args: argparse.Namespace,
    backend: str,
    models: list[str],
    selected: dict[str, int],
    complete: bool,
) -> None:
    image = command_output(
        ["podman", "inspect", args.toolbox, "--format", "{{.ImageName}}"]
    )
    digest = (
        command_output(
            ["podman", "image", "inspect", image, "--format", "{{.Digest}}"]
        )
        if image
        else ""
    )
    record = first_result_record(args.results_dir)
    build_number = record.get("build_number", "")
    build_commit = record.get("build_commit", "")
    llama_build = " ".join(
        value
        for value in (
            str(build_number) if build_number else "",
            f"({build_commit})" if build_commit else "",
        )
        if value
    )
    try:
        cockpit_version = version("llama-cockpit")
    except PackageNotFoundError:
        cockpit_version = "unknown"

    lines = [
        f"campaign: {args.campaign_id}",
        f"host: {args.host_label}",
        f"host_profile: {args.host_profile}",
        f"kernel: {platform.release()}",
        f"toolbox: {args.toolbox}",
        f"backend: {backend}",
        f"image: {image or 'unknown'}",
        f"image_digest: {digest or 'unknown'}",
        f"llama_build: {llama_build or 'unknown'}",
        f"cockpit_package: llama-cockpit {cockpit_version}",
        f"depths: {','.join(str(depth) for depth in DEFAULT_DEPTHS)}",
        "prefill_tokens: 2048",
        "generation_tokens: 128",
        "repetitions: 3",
        f"cooldown_seconds: {args.cooldown}",
        "flash_attention: enabled",
        "load_mode: none",
        "kv_cache_quantization: disabled",
        "ubatch_calibration: 256,512,1024,2048 across all nine depths",
    ]
    for model in models:
        key = model_key(model)
        lines.append(f"{Path(model).name} ubatch: {selected[key]}")
        status = "complete" if complete else "incomplete"
        lines.append(f"{Path(model).name} status: {status}")
    (args.results_dir / "run_metadata.txt").write_text(
        "\n".join(lines) + "\n", encoding="utf-8"
    )


def main() -> None:
    args = parse_args()
    if args.results_dir.exists():
        raise SystemExit(
            f"Refusing to mix results in existing directory: {args.results_dir}"
        )
    args.results_dir.mkdir(parents=True)

    toolbox_command = get_os_toolbox_cmd()
    if not toolbox_command:
        raise SystemExit("No Toolbx or Distrobox command is available")
    backend = backend_from_name(args.toolbox)
    if not backend:
        raise SystemExit(f"Cannot infer backend from {args.toolbox}")

    models = [resolve_model_path(model) for model in args.model]
    selected = {
        model_key(model): selected_candidate(model, args.platform, backend)[0]
        for model in models
    }
    settings = BenchmarkSettings(
        platform_id=args.platform,
        delay=args.cooldown,
        load_mode_toolboxes=frozenset(
            {args.toolbox}
            if toolbox_supports_load_mode(args.platform, args.toolbox)
            else set()
        ),
    )
    jobs = build_benchmark_jobs(
        toolbox_command,
        [args.toolbox],
        models,
        args.results_dir,
        settings,
    )

    statuses = []
    if args.reuse_calibration:
        for model in models:
            chosen, candidate = selected_candidate(model, args.platform, backend)
            prefill = next(
                job
                for job in jobs
                if job.model_path == model and job.series == "prefill"
            )
            command_ubatch = int(prefill.command[prefill.command.index("-ub") + 1])
            if command_ubatch != chosen:
                raise RuntimeError(f"Resolved ubatch mismatch for {model_key(model)}")
            source = Path(candidate["raw_jsonl"])
            validate_calibration_prefill(source, chosen)
            shutil.copy2(source, prefill.output_path)
            source_stderr = Path(candidate["stderr_log"])
            if source_stderr.is_file():
                shutil.copy2(source_stderr, prefill.stderr_path)
            statuses.append(
                {
                    "model": model_key(model),
                    "series": "prefill",
                    "status": "reused-calibration",
                    "return_code": 0,
                    "command": list(prefill.command),
                }
            )

    runnable = [
        job
        for job in jobs
        if not (args.reuse_calibration and job.series == "prefill")
    ]
    for index, job in enumerate(runnable, start=1):
        print(
            f"[{index}/{len(runnable)}] {job.toolbox_name} | "
            f"{Path(job.model_path).name} | {job.series}",
            flush=True,
        )
        status, return_code = run_benchmark_job(job)
        statuses.append(
            {
                "model": model_key(job.model_path),
                "series": job.series,
                "status": status,
                "return_code": return_code,
                "command": list(job.command),
            }
        )
        print(f"  {status}", flush=True)
        if index < len(runnable) and status != "skipped" and args.cooldown:
            time.sleep(args.cooldown)

    summary_path = args.results_dir / "curve_summary.csv"
    rows = write_curve_summary(jobs, summary_path)
    expected_rows = len(models) * 2 * len(DEFAULT_DEPTHS)
    failed = any(item["status"] == "failed" for item in statuses)
    complete = not failed and rows == expected_rows
    manifest = {
        "campaign_id": args.campaign_id,
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "complete": complete,
        "toolbox": args.toolbox,
        "platform": args.platform,
        "backend": backend,
        "reused_calibration_prefill": args.reuse_calibration,
        "selected_ubatches": selected,
        "depths": list(DEFAULT_DEPTHS),
        "summary_rows": rows,
        "expected_summary_rows": expected_rows,
        "statuses": statuses,
    }
    (args.results_dir / "campaign_manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    if DEFAULT_PROFILE_PATH.is_file():
        shutil.copy2(
            DEFAULT_PROFILE_PATH,
            args.results_dir / "ubatch-calibrations.json",
        )
    write_run_metadata(args, backend, models, selected, complete)

    marker = "campaign.finished" if complete else "campaign.failed"
    (args.results_dir / marker).touch()
    print(
        f"Curve summary: {summary_path} ({rows}/{expected_rows} rows)",
        flush=True,
    )
    if not complete:
        raise SystemExit(f"Campaign incomplete; inspect {args.results_dir}")


if __name__ == "__main__":
    main()
