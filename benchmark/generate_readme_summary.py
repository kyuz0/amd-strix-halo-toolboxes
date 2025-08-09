#!/usr/bin/env python3
import json, re
from collections import defaultdict
from pathlib import Path

RESULTS_FILE = "../docs/results.json"

# Column order + labels
ENV_ORDER = [
    "vulkan_amdvlk",
    "vulkan_radv",
    "rocm6_4_2",
    "rocm6_4_2-rocwmma",
    "rocm7_beta",
    "rocm7_rc",
]
COL_NAMES = {
    "vulkan_amdvlk": "Vulkan (AMDVLK)",
    "vulkan_radv": "Vulkan (RADV)",
    "rocm6_4_2": "ROCm 6.4.2",
    "rocm6_4_2-rocwmma": "ROCm 6.4.2 + ROCWMMA",
    "rocm7_beta": "ROCm 7.0 Beta",
    "rocm7_rc": "ROCm 7.0 RC",
}
WINNER_NAMES = {
    "vulkan_amdvlk": "AMDVLK",
    "vulkan_radv": "RADV",
    "rocm6_4_2": "ROCm6.4.2",
    "rocm6_4_2-rocwmma": "ROCm6.4.2+ROCWMMA",
    "rocm7_beta": "ROCm7 Beta",
    "rocm7_rc": "ROCm7 RC",
}
ERROR_LABEL = {
    "load": "⚠️ Load Error",
    "hang": "⚠️ GPU Hang",
    "runtime": "⚠️ Runtime Error",
}

# Display name → fuzzy key (case/UD/shard-insensitive)
DEFAULT_MODELS = [
    ("Gemma3 12B Q8_0",            "gemma-3-12b"),
    ("Gemma3 27B BF16",            "gemma-3-27b"),
    ("Llama-4-Scout 17B Q8_0",     "llama-4-scout-17b-16e-instruct-q8_0"),
    ("Llama-4-Scout 17B Q4_K XL",  "llama-4-scout-17b-16e-instruct-q4_k_xl"),
    ("Qwen3 30B BF16",             "qwen3-30b-a3b-bf16"),
    ("Qwen3-235B Q3_K XL",         "qwen3-235b-a22b"),
    ("GLM-4.5-Air-Q4_K_XL",        "glm-4.5-air-q4_k_xl"),
    ("GLM-4.5-Air-Q6_K_XL",        "glm-4.5-air-q6_k_xl"),
    ("gpt-oss-120b-mxfp4",         "gpt-oss-120b-mxfp4"),
    ("gpt-oss-20b-mxfp4",          "gpt-oss-20b-mxfp4"),
]

SHARD_RE = re.compile(r"-000\d+-of-000\d+", re.IGNORECASE)
def norm_model(s: str) -> str:
    s = (s or "").lower().replace("_", "-")
    s = SHARD_RE.sub("", s)
    s = s.replace("-ud", "")  # drop -UD tag for matching
    return s

# Load JSON
raw = json.loads(Path(RESULTS_FILE).read_text(encoding="utf-8"))
runs = raw["runs"]

# Bucket rows by (model_key, env, test, fa)
buckets = defaultdict(list)
error_only = defaultdict(list)  # (model_key, env) -> [error_type,...] for test=None rows
all_models = set()

for r in runs:
    env = r.get("env")
    if env not in ENV_ORDER:
        continue
    mkey = norm_model(r.get("model_clean") or r.get("model") or "")
    all_models.add(mkey)
    test = r.get("test")  # "pp512", "tg128", or None for pure errors
    if test in ("pp512", "tg128"):
        buckets[(mkey, env, test)].append(r)
    else:
        # capture error-only rows so we can show ⚠️ instead of "—"
        if r.get("error"):
            error_only[(mkey, env)].append(r.get("error_type") or "runtime")

def pick_best(rows):
    """Choose the best non-error row by tps_mean; if all error, return an error row."""
    best = None
    best_val = -1
    fallback = None
    for r in rows:
        if r.get("error"):
            fallback = r
            continue
        v = r.get("tps_mean")
        if isinstance(v, (int, float)) and v > best_val:
            best_val = v
            best = r
    return best or fallback

# Build chosen results per (model, env): {pp: row|None, tg: row|None, err_only: str|None}
chosen = defaultdict(lambda: defaultdict(dict))
for (mkey, env, test), rows in buckets.items():
    chosen_row = pick_best(rows)
    chosen[mkey][env][test] = chosen_row

for (mkey, env), etypes in error_only.items():
    if etypes:
        # prefer specific types in a stable order
        if "load" in etypes:
            chosen[mkey][env]["error_only"] = "load"
        elif "hang" in etypes:
            chosen[mkey][env]["error_only"] = "hang"
        else:
            chosen[mkey][env]["error_only"] = "runtime"

def format_cell(entry_dict):
    pp = entry_dict.get("pp512")
    tg = entry_dict.get("tg128")

    # If either chosen row is an error, show that error (web UI behavior)
    for row in (pp, tg):
        if row and row.get("error"):
            return ERROR_LABEL.get(row.get("error_type") or "runtime", "⚠️ Error")

    # If both pp/tg missing but we have an error-only marker, show it
    if not pp and not tg:
        et = entry_dict.get("error_only")
        if et:
            return ERROR_LABEL.get(et, "⚠️ Error")
        return "—"  # truly absent

    # Otherwise, print available values (partial allowed)
    def fmt(v):
        return f"{int(round(v))}" if isinstance(v, (int, float)) else "—"
    ppv = pp.get("tps_mean") if pp else None
    tgv = tg.get("tps_mean") if tg else None
    return f"{fmt(ppv)} pp / {tgv:.1f} tg" if isinstance(tgv, (int, float)) \
           else f"{fmt(ppv)} pp / — tg"

def best_env_for(mkey, test):
    best_env, best_val = None, -1
    for env in ENV_ORDER:
        row = chosen[mkey].get(env, {}).get(test)
        if not row or row.get("error"):
            continue
        v = row.get("tps_mean")
        if isinstance(v, (int, float)) and v > best_val:
            best_env, best_val = env, v
    return best_env

# Fuzzy match helper
def find_model_key(fuzzy):
    needle = norm_model(fuzzy)
    for k in all_models:
        if needle in k:
            return k
    return None

# Print table
header = ["Model"] + [COL_NAMES[e] for e in ENV_ORDER] + ["🏆 Best PP", "🏆 Best TG"]
print("| " + " | ".join(header) + " |")
print("|" + "|".join(["---"] * len(header)) + "|")

for disp, fuzzy in DEFAULT_MODELS:
    mkey = find_model_key(fuzzy)
    if not mkey:
        print("| " + " | ".join([f"**{disp}**"] + ["—"]*len(ENV_ORDER) + ["—","—"]) + " |")
        continue
    row = [f"**{disp}**"]
    for env in ENV_ORDER:
        row.append(format_cell(chosen[mkey].get(env, {})))
    bpp = best_env_for(mkey, "pp512")
    btg = best_env_for(mkey, "tg128")
    row.append(f"🏆 **{WINNER_NAMES[bpp]}**" if bpp else "—")
    row.append(f"🏆 **{WINNER_NAMES[btg]}**" if btg else "—")
    print("| " + " | ".join(row) + " |")
