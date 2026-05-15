#!/usr/bin/env python3
"""
MTP Benchmark Runner — Automated Multi-Token Prediction benchmarking.

Auto-discovers MTP GGUF models, starts llama-server in podman containers
(with and without MTP), runs mtp-bench.py against each configuration,
and collects structured JSON results.

Usage:
    python run_mtp_bench.py                          # run everything
    python run_mtp_bench.py --model "Qwen3.6-35B"    # filter by model name
    python run_mtp_bench.py --toolbox vulkan-radv-mtp # filter by toolbox
    python run_mtp_bench.py --models-dir /path/to/models
    python run_mtp_bench.py --port 8081
"""

import argparse
import datetime
import json
import os
import platform
import subprocess
import sys
import time
from pathlib import Path
from urllib import request
from urllib.error import URLError

# ── Toolbox definitions ──────────────────────────────────────────────────────

TOOLBOXES = {
    "rocm-7.2.3-mtp": {
        "image": "docker.io/kyuz0/amd-strix-halo-toolboxes:rocm-7.2.3-mtp",
        "engine_args": [
            "--device", "/dev/dri",
            "--device", "/dev/kfd",
            "--group-add", "video",
            "--group-add", "render",
            "--security-opt", "seccomp=unconfined",
        ],
    },
    "vulkan-radv-mtp": {
        "image": "docker.io/kyuz0/amd-strix-halo-toolboxes:vulkan-radv-mtp",
        "engine_args": [
            "--device", "/dev/dri",
            "--group-add", "video",
            "--security-opt", "seccomp=unconfined",
        ],
    },
}

# ── Benchmark modes ──────────────────────────────────────────────────────────

MODES = {
    "baseline": [],
    "mtp-2": ["--spec-type", "draft-mtp", "--spec-draft-n-max", "2", "-np", "1"],
    "mtp-3": ["--spec-type", "draft-mtp", "--spec-draft-n-max", "3", "-np", "1"],
}

# ── Constants ────────────────────────────────────────────────────────────────

CONTAINER_NAME = "mtp-bench-server"
HEALTH_TIMEOUT = 180   # seconds to wait for server readiness
HEALTH_INTERVAL = 3    # seconds between health polls
COOLDOWN = 5           # seconds between runs
BENCH_SCRIPT = Path(__file__).parent / "mtp-bench.py"


def _sigint_handler(sig, frame):
    """Clean up container on Ctrl+C."""
    print("\n\n🛑 Interrupted — cleaning up container...")
    subprocess.run(["podman", "stop", "-t", "3", CONTAINER_NAME], capture_output=True)
    subprocess.run(["podman", "rm", "-f", CONTAINER_NAME], capture_output=True)
    sys.exit(1)

import signal
signal.signal(signal.SIGINT, _sigint_handler)


# ── Model discovery ──────────────────────────────────────────────────────────

def discover_models(models_dir: Path) -> list[dict]:
    """Scan models_dir for GGUF files with 'MTP' in their path."""
    models = []
    if not models_dir.is_dir():
        print(f"❌ Models directory not found: {models_dir}")
        sys.exit(1)

    for gguf in sorted(models_dir.rglob("*.gguf")):
        rel = gguf.relative_to(models_dir)
        # Must have MTP somewhere in the path (case-insensitive)
        if "mtp" not in str(rel).lower():
            continue
        # Skip non-first shards of multi-shard models
        name = gguf.name
        if "-000" in name and "-00001-of-" not in name:
            continue

        # Derive display name from parent directory or filename
        if gguf.parent != models_dir:
            display_name = gguf.parent.name
        else:
            display_name = gguf.stem

        models.append({
            "name": display_name,
            "gguf": str(rel),
        })

    return models


# ── System info ──────────────────────────────────────────────────────────────

def capture_system_info(results_dir: Path):
    """Write system_info.json if it doesn't exist."""
    path = results_dir / "system_info.json"
    if path.exists():
        return

    def get_distro():
        try:
            with open("/etc/os-release") as f:
                for line in f:
                    if line.startswith("PRETTY_NAME="):
                        return line.split("=", 1)[1].strip().strip('"')
        except Exception:
            pass
        return "Linux"

    def get_linux_firmware():
        try:
            r = subprocess.run(["rpm", "-q", "linux-firmware"],
                               capture_output=True, text=True)
            if r.returncode == 0:
                return r.stdout.strip()
        except Exception:
            pass
        return "unknown"

    info = {
        "distro": get_distro(),
        "kernel": platform.release(),
        "linux_firmware": get_linux_firmware(),
        "timestamp": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
    path.write_text(json.dumps(info, indent=2) + "\n")
    print(f"📋 Captured system info → {path}")


# ── Cleanup & container lifecycle ────────────────────────────────────────────

def check_port_free(port: int) -> bool:
    """Check if a port is free. If not, identify and report what's using it."""
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def kill_port_holder(port: int):
    """Find and kill whatever process is holding the port."""
    result = subprocess.run(
        ["fuser", f"{port}/tcp"],
        capture_output=True, text=True,
    )
    pids = result.stdout.strip().split()
    if pids:
        print(f"  ⚠️  Port {port} held by PID(s): {', '.join(pids)} — killing...")
        for pid in pids:
            pid = pid.strip()
            if pid.isdigit():
                subprocess.run(["kill", "-9", pid], capture_output=True)
        time.sleep(2)
    else:
        # fuser didn't find it, try ss as fallback
        result = subprocess.run(
            ["ss", "-tlnp", f"sport = :{port}"],
            capture_output=True, text=True,
        )
        if result.stdout.strip():
            print(f"  ⚠️  Port {port} is in use (could not identify PID):")
            print(f"     {result.stdout.strip()}")


def cleanup(port: int):
    """Full cleanup: stop stale containers and free the port."""
    # Stop any leftover benchmark container
    stop_container()

    # Check for port conflicts
    if not check_port_free(port):
        print(f"  ⚠️  Port {port} is already in use — attempting cleanup...")
        kill_port_holder(port)
        time.sleep(1)
        if not check_port_free(port):
            print(f"  ❌ Port {port} is still in use after cleanup. Aborting.")
            return False
        print(f"  ✅ Port {port} is now free.")
    return True


def stop_container():
    """Stop and remove the benchmark container if it exists."""
    subprocess.run(["podman", "stop", "-t", "5", CONTAINER_NAME],
                   capture_output=True)
    subprocess.run(["podman", "rm", "-f", CONTAINER_NAME],
                   capture_output=True)


def start_server(toolbox: dict, gguf: str, models_dir: Path,
                 spec_flags: list[str], port: int) -> bool:
    """Start llama-server in a podman container. Returns True on success."""
    if not cleanup(port):
        return False

    cmd = [
        "podman", "run", "--rm", "--replace", "-d",
        "--name", CONTAINER_NAME,
        "--security-opt", "label=disable",
        "--userns=keep-id",
        *toolbox["engine_args"],
        "-v", f"{models_dir}:/models:ro",
        "-p", f"127.0.0.1:{port}:{port}",
        toolbox["image"],
        "llama-server",
        "-m", f"/models/{gguf}",
        "-c", "12288",
        "-ngl", "999",
        "--host", "0.0.0.0",
        "--port", str(port),
        "--no-mmap",
        "-fa", "1",
        "--jinja",
        *spec_flags,
    ]

    print(f"  🐳 Starting container...")
    print(f"     {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  ❌ Failed to start container: {result.stderr.strip()}")
        return False
    return True


def is_container_alive() -> bool:
    """Check if the benchmark container is still running."""
    result = subprocess.run(
        ["podman", "inspect", "--format", "{{.State.Status}}", CONTAINER_NAME],
        capture_output=True, text=True,
    )
    return result.returncode == 0 and result.stdout.strip() == "running"


def get_last_log_line() -> str:
    """Get the last meaningful log line from the container."""
    result = subprocess.run(
        ["podman", "logs", "--tail", "3", CONTAINER_NAME],
        capture_output=True, text=True,
    )
    # Merge stdout+stderr (llama-server logs to stderr)
    lines = (result.stdout + result.stderr).strip().split("\n")
    # Return last non-empty line
    for line in reversed(lines):
        line = line.strip()
        if line:
            return line[:120]  # truncate for display
    return ""


def wait_for_health(port: int) -> bool:
    """Poll /health until the server is ready. Detects dead containers."""
    url = f"http://127.0.0.1:{port}/health"
    deadline = time.time() + HEALTH_TIMEOUT
    last_status_time = 0
    status_interval = 15  # show log progress every 15s
    polls = 0

    print(f"  ⏳ Waiting for server health ({HEALTH_TIMEOUT}s timeout)...")

    # Brief initial wait for container to start
    time.sleep(3)

    while time.time() < deadline:
        polls += 1

        # Check if container died (or was auto-removed by --rm)
        if not is_container_alive():
            print(f"  ❌ Container exited — model likely failed to load.")
            # Try to get logs (won't work if --rm already cleaned up)
            logs = subprocess.run(
                ["podman", "logs", "--tail", "20", CONTAINER_NAME],
                capture_output=True, text=True,
            )
            output = (logs.stdout + logs.stderr).strip()
            if output and "no container with name" not in output:
                print(f"  📝 Container logs:")
                for line in output.split("\n")[-10:]:
                    print(f"     {line}")
            else:
                print(f"  💡 Container was auto-removed. To see the error, run manually:")
                print(f"     podman run --name debug-server ... (without -d)")
            return False

        # Try health endpoint
        try:
            req = request.Request(url, method="GET")
            with request.urlopen(req, timeout=5) as r:
                if r.status == 200:
                    data = json.loads(r.read())
                    if data.get("status") == "ok":
                        print(f"  ✅ Server ready!")
                        return True
        except (URLError, OSError, json.JSONDecodeError):
            pass

        # Periodically show what the server is doing
        now = time.time()
        if now - last_status_time >= status_interval:
            last_status_time = now
            elapsed = int(now - (deadline - HEALTH_TIMEOUT))
            log_line = get_last_log_line()
            if log_line:
                print(f"     [{elapsed}s] {log_line}")
            else:
                print(f"     [{elapsed}s] (waiting...)")

        time.sleep(HEALTH_INTERVAL)

    print(f"  ❌ Health check timeout after {HEALTH_TIMEOUT}s")
    # Dump container logs for debugging
    logs = subprocess.run(["podman", "logs", "--tail", "30", CONTAINER_NAME],
                          capture_output=True, text=True)
    output = (logs.stdout + logs.stderr).strip()
    if output:
        print(f"  📝 Last lines of server logs:")
        for line in output.split("\n")[-15:]:
            print(f"     {line}")
    return False


# ── Benchmark execution ──────────────────────────────────────────────────────

def run_benchmark(port: int, out_path: Path) -> dict | None:
    """Run mtp-bench.py as subprocess. Returns parsed JSON or None."""
    cmd = [
        sys.executable, str(BENCH_SCRIPT),
        "--url", f"http://127.0.0.1:{port}",
        "--out", str(out_path),
    ]
    print(f"  🔬 Running benchmark...")
    result = subprocess.run(cmd, capture_output=False)
    if result.returncode != 0:
        print(f"  ❌ Benchmark failed (exit {result.returncode})")
        return None

    try:
        return json.loads(out_path.read_text())
    except Exception as e:
        print(f"  ❌ Failed to read results: {e}")
        return None


# ── Results handling ─────────────────────────────────────────────────────────

def save_result(out_path: Path, model: dict, toolbox_name: str,
                mode: str, spec_flags: list[str], bench_data: dict):
    """Wrap mtp-bench output with run metadata and save."""
    wrapped = {
        "model": model["name"],
        "gguf": model["gguf"],
        "toolbox": toolbox_name,
        "mode": mode,
        "spec_flags": " ".join(spec_flags) if spec_flags else "(none)",
        "timestamp": datetime.datetime.now().isoformat(),
        **bench_data,
    }
    out_path.write_text(json.dumps(wrapped, indent=2) + "\n")


def print_summary(results_dir: Path):
    """Read all result JSONs and print a summary table."""
    results = []
    for f in sorted(results_dir.glob("*.json")):
        if f.name == "system_info.json" or f.name == "summary.json":
            continue
        try:
            data = json.loads(f.read_text())
            if "aggregate" in data:
                results.append(data)
        except Exception:
            continue

    if not results:
        print("\n📊 No results found.")
        return

    # Compute average tok/s per result
    for r in results:
        prompts = r.get("results", [])
        if prompts:
            r["_avg_toks"] = sum(p.get("predicted_per_second", 0) for p in prompts) / len(prompts)
        else:
            r["_avg_toks"] = 0

    # Build baseline lookup for speedup calculation
    baselines = {}
    for r in results:
        if r["mode"] == "baseline":
            key = (r["model"], r["toolbox"])
            baselines[key] = r["_avg_toks"]

    # Print table
    print("\n" + "=" * 100)
    print(f"{'Model':<30} {'Toolbox':<20} {'Mode':<10} {'Avg tok/s':>10} {'Accept%':>9} {'Wall(s)':>8} {'Speedup':>8}")
    print("-" * 100)

    for r in results:
        agg = r.get("aggregate", {})
        accept = agg.get("aggregate_accept_rate")
        wall = agg.get("wall_s_total", 0)
        accept_str = f"{accept * 100:.1f}%" if accept is not None else "—"
        avg_toks = r["_avg_toks"]

        # Speedup relative to baseline
        baseline_key = (r["model"], r["toolbox"])
        baseline_toks = baselines.get(baseline_key)
        if baseline_toks and baseline_toks > 0:
            speedup = f"{avg_toks / baseline_toks:.2f}×"
        else:
            speedup = "—"

        print(f"{r['model']:<30} {r['toolbox']:<20} {r['mode']:<10} {avg_toks:>10.1f} {accept_str:>9} {wall:>8.1f} {speedup:>8}")

    print("=" * 100)

    # Write summary.json
    summary_data = []
    for r in results:
        agg = r.get("aggregate", {})
        summary_data.append({
            "model": r["model"],
            "toolbox": r["toolbox"],
            "mode": r["mode"],
            "avg_tok_s": round(r["_avg_toks"], 1),
            "accept_rate": agg.get("aggregate_accept_rate"),
            "wall_s_total": agg.get("wall_s_total"),
        })

    summary_path = results_dir / "summary.json"
    summary_path.write_text(json.dumps(summary_data, indent=2) + "\n")
    print(f"\n📄 Summary written to {summary_path}")


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="MTP Benchmark Runner")
    ap.add_argument("--models-dir", type=Path, default=Path.home() / "models",
                    help="Directory containing GGUF models (default: ~/models)")
    ap.add_argument("--model", type=str, default=None,
                    help="Filter: only run models whose name contains this string")
    ap.add_argument("--toolbox", type=str, default=None,
                    help="Filter: only run this toolbox (e.g. 'vulkan-radv-mtp')")
    ap.add_argument("--port", type=int, default=8080,
                    help="Port for llama-server (default: 8080)")
    args = ap.parse_args()

    models_dir = args.models_dir.expanduser().resolve()
    results_dir = Path(__file__).parent / "results-mtp"
    results_dir.mkdir(exist_ok=True)

    # Discover models
    models = discover_models(models_dir)
    if args.model:
        models = [m for m in models if args.model.lower() in m["name"].lower()]

    if not models:
        print(f"❌ No MTP models found in {models_dir}")
        sys.exit(1)

    # Filter toolboxes
    toolboxes = TOOLBOXES
    if args.toolbox:
        if args.toolbox not in TOOLBOXES:
            print(f"❌ Unknown toolbox: {args.toolbox}")
            print(f"   Available: {', '.join(TOOLBOXES.keys())}")
            sys.exit(1)
        toolboxes = {args.toolbox: TOOLBOXES[args.toolbox]}

    # Print run plan
    print(f"\n🔍 Discovered {len(models)} MTP model(s):")
    for m in models:
        print(f"   • {m['name']}  →  {m['gguf']}")

    print(f"\n🧰 Toolboxes: {', '.join(toolboxes.keys())}")
    print(f"📊 Modes: {', '.join(MODES.keys())}")
    total = len(models) * len(toolboxes) * len(MODES)
    print(f"📋 Total runs: {total}\n")

    # Capture system info
    capture_system_info(results_dir)

    # Pre-flight cleanup
    print("🧹 Pre-flight cleanup...")
    if not cleanup(args.port):
        print("❌ Cannot free port — exiting.")
        sys.exit(1)
    print("✅ Environment clean.\n")

    # Run benchmarks
    run_count = 0
    for tb_name, tb_config in toolboxes.items():
        for model in models:
            for mode_name, spec_flags in MODES.items():
                run_count += 1
                out_file = results_dir / f"{model['name']}__{tb_name}__{mode_name}.json"

                print(f"\n{'─' * 80}")
                print(f"▶ [{run_count}/{total}] {model['name']}  |  {tb_name}  |  {mode_name}")
                print(f"  Output: {out_file.name}")

                # Skip if results exist
                if out_file.exists():
                    print(f"  ⏩ Skipping — results already exist")
                    continue

                # Start server
                if not start_server(tb_config, model["gguf"], models_dir,
                                    spec_flags, args.port):
                    stop_container()
                    continue

                # Wait for health
                if not wait_for_health(args.port):
                    stop_container()
                    continue

                # Run benchmark
                bench_data = run_benchmark(args.port, out_file)

                # Stop server
                print(f"  🛑 Stopping container...")
                stop_container()

                # Wrap result with metadata
                if bench_data:
                    save_result(out_file, model, tb_name, mode_name,
                                spec_flags, bench_data)
                    print(f"  ✅ Done — saved to {out_file.name}")
                else:
                    print(f"  ❌ No results collected")

                # Cooldown
                if run_count < total:
                    print(f"  💤 Cooldown ({COOLDOWN}s)...")
                    time.sleep(COOLDOWN)

    # Print summary
    print_summary(results_dir)


if __name__ == "__main__":
    main()
