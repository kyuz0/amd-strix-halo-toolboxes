#!/usr/bin/env python3
import re, glob, os, json, time
from pathlib import Path

RESULT_SOURCES = [
    ("results", False),       # regular single-node runs
    ("results-rpc", True),    # distributed RPC runs across two servers
]
OUT_JSON = "../docs/results.json"

# --- Regexes ---------------------------------------------------------------

# Table headers come in two shapes (with or without "fa" column)
HEADER_RE = re.compile(r"^\|\s*model\s*\|", re.IGNORECASE)
SEP_RE    = re.compile(r"^\|\s*-+")

# Build line, e.g. "build: cd6983d5 (6119)"
BUILD_RE  = re.compile(r"build:\s*([0-9a-f]{7,})\s*\((\d+)\)", re.IGNORECASE)

# Error classifiers (same spirit as your table script)
LOAD_ERR   = re.compile(r"failed to load model|Device memory allocation.*failed|⚠️\s*Fail", re.IGNORECASE)
HANG_ERR   = re.compile(r"GPU Hang|HW Exception", re.IGNORECASE)
GENERIC_ERR= re.compile(r"error:|exit \d+|runtime error|⚠️\s*Runtime Error", re.IGNORECASE)

# Extract numeric ± numeric from the last column
TS_RE      = re.compile(r"([\d.]+)\s*±\s*([\d.]+)")

# Quantization from model name
QUANT_RE = re.compile(r"(Q\d+_[A-Z0-9_]+|BF16|F16|F32|mxfp\d+)", re.IGNORECASE)

PARAMS_RE = re.compile(r"([\d.,]+)\s*B", re.IGNORECASE)
GIB_RE    = re.compile(r"([\d.,]+)\s*GiB", re.IGNORECASE)

# "30B", "235B" from model name
NAME_B_RE = re.compile(r"(\d+(?:\.\d+)?)B")

# Shard suffix in filenames
SHARD_RE = re.compile(r"-000\d+-of-000\d+", re.IGNORECASE)

# Long-context suffix in filenames (e.g., __longctx32768)
LONGCTX_RE = re.compile(r"longctx(\d+)", re.IGNORECASE)

# --- Helpers ---------------------------------------------------------------

ENV_CANON = {
    "rocm7_1": "rocm7.1",
    "rocm7_alpha": "rocm-7alpha",
}

def clean_model_name(raw):
    base = SHARD_RE.sub("", raw)
    return base

def canonicalize_env(env):
    if not env:
        return env
    for raw, canon in ENV_CANON.items():
        prefix = f"{raw}-"
        if env == raw:
            return canon
        if env.startswith(prefix):
            return canon + env[len(raw):]
    return env

def parse_env_flags(basename):
    """
    pattern: <model>__<env>[__fa1][__hblt0][__longctx32768][__rpc]
    Returns (env, fa, context_tag, context_tokens, rpc_flag)
    """
    parts = basename.split("__")
    if len(parts) < 2:
        return None, False, "default", None, False

    env = parts[1]
    fa = False
    context_tag = "default"
    context_tokens = None
    rpc_flag = False

    for raw_suffix in parts[2:]:
        suffix = raw_suffix.lower()
        if suffix == "fa1":
            fa = True
        elif suffix == "hblt0":
            env = f"{env}-hblt0"
        elif suffix.startswith("longctx"):
            context_tag = suffix
            m = LONGCTX_RE.search(suffix)
            if m:
                try:
                    context_tokens = int(m.group(1))
                except ValueError:
                    context_tokens = None
        elif suffix == "rpc":
            rpc_flag = True

    return env, fa, context_tag, context_tokens, rpc_flag

def env_base_and_variant(env):
    # e.g. "rocm6_4_2-rocwmma" -> ("rocm6_4_2", "rocwmma")
    if "-" in env:
        base, variant = env.split("-", 1)
        return base, variant
    return env, None

def detect_error(text):
    if LOAD_ERR.search(text):
        return True, "load"
    if HANG_ERR.search(text):
        return True, "hang"
    if GENERIC_ERR.search(text):
        return True, "runtime"
    return False, None

def parse_table(text):
    """
    Returns list of rows parsed from the markdown-like table.
    Each row is a dict of the parsed columns, normalized by header names.
    Handles presence/absence of the 'fa' column.
    """
    lines = text.splitlines()
    rows = []
    header = None
    col_idx = {}

    for i, line in enumerate(lines):
        if HEADER_RE.search(line):
            # header line
            header = [c.strip().lower() for c in line.strip().strip("|").split("|")]
            # next line should be the separator; skip it
            # build index map
            for idx, name in enumerate(header):
                col_idx[name] = idx
            continue
        if header and (SEP_RE.search(line) or not line.strip()):
            # skip separators / blanks after header
            continue
        if header and line.startswith("|"):
            parts = [c.strip() for c in line.strip().strip("|").split("|")]
            # guard for short lines
            if len(parts) < len(header):
                continue
            row = {}
            for name, idx in col_idx.items():
                row[name] = parts[idx]
            rows.append(row)
        # stop parsing block when a blank line after some rows appears
        if header and line.strip() == "" and rows:
            break

    return rows

def coerce_float(m, default=None):
    try:
        return float(m)
    except:
        return default

def extract_quant(model_name):
    m = QUANT_RE.search(model_name)
    return (m.group(1).upper() if m else None)

def b_from_name(model_name):
    m = NAME_B_RE.search(model_name)
    return coerce_float(m.group(1)) if m else None

# --- Main scan -------------------------------------------------------------

runs = []
builds = set()
envs  = set()

for results_dir, is_rpc_source in RESULT_SOURCES:
    glob_pattern = os.path.join(results_dir, "*.log")
    for path in sorted(glob.glob(glob_pattern)):
        base = os.path.basename(path).rsplit(".log", 1)[0]
        if "__" not in base:
            continue

        model_raw, _rest = base.split("__", 1)
        env, fa_from_name, context_tag, context_tokens, rpc_flag = parse_env_flags(base)
        env = canonicalize_env(env)
        if env:
            envs.add(env)

        model_clean = clean_model_name(model_raw)

        with open(path, errors="ignore") as f:
            text = f.read()

        # build info (take the last match in file if many)
        build_hash, build_num = None, None
        for m in BUILD_RE.finditer(text):
            build_hash, build_num = m.group(1), m.group(2)
        if build_hash:
            builds.add((build_hash, build_num))

        # detect error (if there is no valid table rows)
        table_rows = parse_table(text)

        # If table rows exist, we’ll still mark errors only if no perf found
        has_pp = any(r.get("test","").lower()=="pp512" for r in table_rows)
        has_tg = any(r.get("test","").lower()=="tg128" for r in table_rows)
        error, etype = (False, None)
        if not (has_pp or has_tg):
            error, etype = detect_error(text)

        # Determine FA flag:
        #   prefer explicit column "fa" if present, else fallback to filename "__fa1"
        fa_in_table = None
        for r in table_rows:
            if "fa" in r:
                try:
                    fa_in_table = int(r["fa"]) == 1
                except:
                    fa_in_table = None
                break
        fa_enabled = fa_in_table if fa_in_table is not None else fa_from_name

        # Normalize env base / variant (e.g., rocwmma)
        env_base, env_variant = env_base_and_variant(env)

        # Emit one run per row (pp512 / tg128)
        for r in table_rows or [{}]:
            test = r.get("test", "").lower() if table_rows else None
            tps_mean, tps_std = None, None
            if table_rows:
                ts_field = r.get("t/s", "")
                m = TS_RE.search(ts_field)
                if m:
                    tps_mean = coerce_float(m.group(1))
                    tps_std  = coerce_float(m.group(2))

            # parse numeric helpers from row (if present)
            params_b = None
            file_size_gib = None
            if "params" in r:
                pm = PARAMS_RE.search(r["params"])
                if pm:
                    params_b = coerce_float(pm.group(1).replace(",", ""))
            if "size" in r:
                sm = GIB_RE.search(r["size"])
                if sm:
                    file_size_gib = coerce_float(sm.group(1).replace(",", ""))

            # quant from model name (unchanged)
            quant = extract_quant(model_clean)

            # name_params_b: prefer table value; else fall back to B in model name
            name_params_b = params_b if params_b is not None else b_from_name(model_clean)

            backend = r.get("backend")
            ngl = r.get("ngl")
            mmap = r.get("mmap")

            run = {
                "model": model_raw,
                "model_clean": model_clean,
                "env": env,
                "env_base": env_base,
                "env_variant": env_variant,         # e.g. "rocwmma"
                "fa": bool(fa_enabled),
                "context": context_tag or "default",
                "context_tokens": context_tokens,
                "test": test,                       # "pp512" | "tg128" | None (if error)
                "tps_mean": tps_mean,
                "tps_std": tps_std,
                "error": bool(error),
                "error_type": etype,                # "load" | "hang" | "runtime" | None
                "backend": backend,
                "ngl": (int(ngl) if (ngl and ngl.isdigit()) else None),
                "mmap": (int(mmap) if (mmap and mmap.isdigit()) else None),
                "params_b": params_b,               # from table, if available
                "file_size_gib": file_size_gib,     # from table, if available
                "name_params_b": name_params_b,     # parsed from model name (e.g., 30B -> 30.0)
                "quant": quant,
                "log": path,
                "rpc": bool(is_rpc_source or rpc_flag),
                "build": {"hash": build_hash, "number": build_num} if build_hash else None,
            }
            runs.append(run)

# Meta
meta = {
    "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "os_kernel": "Fedora 42 — Linux 6.15.9-201.fc42.x86_64 (Sat Aug  2 11:37:34 UTC 2025)",
    "llamacpp_builds": [{"hash": h, "number": n} for (h, n) in sorted(builds)],
    "environments": sorted(envs),
    "notes": "pp512 = prompt processing; tg128 = text generation; t/s = tokens/second",
}

out = {"meta": meta, "runs": runs}

Path(OUT_JSON).write_text(json.dumps(out, indent=2))
print(f"Wrote {OUT_JSON} with {len(runs)} rows.")
