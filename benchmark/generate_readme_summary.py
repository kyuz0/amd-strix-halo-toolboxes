#!/usr/bin/env python3
import json
from pathlib import Path

# --- Config ---
RESULTS_JSON = Path("../docs/results.json")

ENV_ORDER = [
    "vulkan_amdvlk",
    "vulkan_radv",
    "rocm6_4_2",
    "rocm6_4_2-rocwmma",
    "rocm7_beta",
    "rocm7_rc"
]

COL_NAMES = {
    "vulkan_amdvlk": "Vulkan (AMDVLK)",
    "vulkan_radv": "Vulkan (RADV)",
    "rocm6_4_2": "ROCm 6.4.2",
    "rocm6_4_2-rocwmma": "ROCm 6.4.2 + ROCWMMA",
    "rocm7_beta": "ROCm 7.0 Beta",
    "rocm7_rc": "ROCm 7.0 RC"
}

WINNER_LABELS = {
    "vulkan_amdvlk": "AMDVLK",
    "vulkan_radv": "RADV",
    "rocm6_4_2": "ROCm6.4.2",
    "rocm6_4_2-rocwmma": "ROCm6.4.2+ROCWMMA",
    "rocm7_beta": "ROCm7 Beta",
    "rocm7_rc": "ROCm7 RC"
}

DEFAULT_MODELS = [
    ("Gemma3 12B Q8_0", "gemma-3-12b-it-UD-Q8_K_XL"),
    ("Gemma3 27B BF16", "gemma-3-27b-it-BF16"),
    ("Llama-4-Scout 17B Q8_0", "Llama-4-Scout-17B-16E-Instruct-Q8_0"),
    ("Llama-4-Scout 17B Q4_K XL", "Llama-4-Scout-17B-16E-Instruct-UD-Q4_K_XL"),
    ("Qwen3 30B BF16", "Qwen3-30B-A3B-BF16"),
    ("Qwen3-235B Q3_K XL", "Qwen3-235B-A22B-Instruct-2507-UD-Q3_K_XL"),
    ("GLM-4.5-Air-Q4_K_XL", "GLM-4.5-Air-UD-Q4_K_XL"),
    ("GLM-4.5-Air-Q6_K_XL", "GLM-4.5-Air-UD-Q6_K_XL"),
    ("gpt-oss-120b-mxfp4", "gpt-oss-120b-mxfp4"),
    ("gpt-oss-20b-mxfp4", "gpt-oss-20b-mxfp4"),
]

ERROR_LABELS = {
    "load": "⚠️ Load Error",
    "hang": "⚠️ GPU Hang",
    "runtime": "⚠️ Runtime Error"
}

# --- Helpers ---
def load_results():
    data = json.loads(Path(RESULTS_JSON).read_text())
    return data["runs"]

def filter_runs(runs, model_prefix, env):
    for r in runs:
        if r["model_clean"].startswith(model_prefix) and r["env"] == env:
            return r
    return None

def format_cell(pp_run, tg_run):
    if not pp_run or not tg_run:
        return "—"
    if pp_run["error"] or tg_run["error"]:
        return ERROR_LABELS.get(pp_run["error_type"] or tg_run["error_type"], "⚠️ Error")
    if pp_run["tps_mean"] is None or tg_run["tps_mean"] is None:
        return "—"
    return f"{int(round(pp_run['tps_mean']))} pp / {tg_run['tps_mean']:.1f} tg"

def find_winner(runs, model_prefix, bench_type):
    vals = {}
    for env in ENV_ORDER:
        r = filter_runs(runs, model_prefix, env)
        if r and not r["error"] and r["test"] == bench_type and r["tps_mean"] is not None:
            vals[env] = r["tps_mean"]
    if not vals:
        return None
    return max(vals, key=vals.get)

# --- Main ---
def main():
    runs = load_results()

    header = ["Model"] + [COL_NAMES[e] for e in ENV_ORDER] + ["🏆 Best PP", "🏆 Best TG"]
    print("| " + " | ".join(header) + " |")
    print("|" + "|".join(["---"] * len(header)) + "|")

    for disp_name, model_prefix in DEFAULT_MODELS:
        row = [f"**{disp_name}**"]
        for env in ENV_ORDER:
            pp_run = filter_runs(runs, model_prefix, env)
            tg_run = filter_runs(runs, model_prefix, env)
            pp = None
            tg = None
            if pp_run and pp_run["test"] == "pp512":
                pp = pp_run
            if tg_run and tg_run["test"] == "tg128":
                tg = tg_run
            # match pp and tg runs by env
            pp_env_run = next((r for r in runs if r["model_clean"].startswith(model_prefix) and r["env"] == env and r["test"] == "pp512"), None)
            tg_env_run = next((r for r in runs if r["model_clean"].startswith(model_prefix) and r["env"] == env and r["test"] == "tg128"), None)
            row.append(format_cell(pp_env_run, tg_env_run))

        bpp = find_winner(runs, model_prefix, "pp512")
        btg = find_winner(runs, model_prefix, "tg128")
        row.append(f"🏆 **{WINNER_LABELS[bpp]}**" if bpp else "—")
        row.append(f"🏆 **{WINNER_LABELS[btg]}**" if btg else "—")

        print("| " + " | ".join(row) + " |")

    print("\nFull interactive results: [Live Benchmark Viewer](https://your-live-results-url)")

if __name__ == "__main__":
    main()
