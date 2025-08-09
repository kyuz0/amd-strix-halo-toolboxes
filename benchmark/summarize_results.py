#!/usr/bin/env python3
import json
from collections import defaultdict
from statistics import mean

# CONFIG
TOLERANCE_MULTIPLIER = 1.0  # multiplier for std dev to count as "within best"

def within_tolerance(best_mean, best_std, contender_mean, contender_std):
    # Winner if contender is within (best_mean - best_std * tol) of best_mean
    return contender_mean >= (best_mean - TOLERANCE_MULTIPLIER * best_std)

# --- Load data ---
with open("../docs/results.json", encoding="utf-8") as f:
    data = json.load(f)

runs = data["runs"]

# --- Group by benchmark type ---
benchmarks = defaultdict(list)
for r in runs:
    if r["error"]:
        continue
    if r["test"] in ("pp512", "tg128"):
        benchmarks[r["test"]].append(r)

summary = {}

for bench_type, results in benchmarks.items():
    winners_count = defaultdict(int)
    backend_perf = defaultdict(list)

    # Group results by model
    models = defaultdict(list)
    for r in results:
        models[r["model_clean"]].append(r)

    for model, entries in models.items():
        # Find the best mean
        best_entry = max(entries, key=lambda x: x["tps_mean"])
        best_mean = best_entry["tps_mean"]
        best_std = best_entry["tps_std"] or 0

        # Find all within tolerance
        for e in entries:
            if e["tps_mean"] is None:
                continue
            if within_tolerance(best_mean, best_std, e["tps_mean"], e["tps_std"] or 0):
                label = f"{e['env']}{' (FA on)' if e['fa'] else ' (FA off)'}"
                winners_count[label] += 1

        # Collect performance data for average TPS
        for e in entries:
            label = f"{e['env']}{' (FA on)' if e['fa'] else ' (FA off)'}"
            if e["tps_mean"] is not None:
                backend_perf[label].append(e["tps_mean"])

    # Store summary
    summary[bench_type] = {
        "winners": dict(sorted(winners_count.items(), key=lambda x: -x[1])),
        "avg_perf": {k: round(mean(v), 2) for k, v in backend_perf.items()},
        "total_models": len(models),
    }

# --- Print human-readable analysis ---
for bench_type in ("pp512", "tg128"):
    if bench_type not in summary:
        continue
    print(f"\n=== {bench_type.upper()} ===")
    print(f"Models tested: {summary[bench_type]['total_models']}")
    print("Winner counts (within tolerance):")
    for backend, count in summary[bench_type]["winners"].items():
        print(f"  {backend}: {count} models")
    print("Average throughput (tokens/sec):")
    for backend, avg in sorted(summary[bench_type]["avg_perf"].items(), key=lambda x: -x[1]):
        print(f"  {backend}: {avg}")

