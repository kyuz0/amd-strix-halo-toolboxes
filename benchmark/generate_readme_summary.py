#!/usr/bin/env python3
import re, glob, os, argparse

PP_RE = re.compile(r"\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|\s*pp512\s*\|\s*([\d.]+)\s*±\s*([\d.]+)")
TG_RE = re.compile(r"\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|\s*tg128\s*\|\s*([\d.]+)\s*±\s*([\d.]+)")
LOAD_ERR = re.compile(r"failed to load model|Device memory allocation.*failed", re.IGNORECASE)
HANG_ERR = re.compile(r"GPU Hang|HW Exception", re.IGNORECASE)
GEN_ERR  = re.compile(r"error:|exit \d+", re.IGNORECASE)

ENV_ORDER = ["vulkan_amdvlk","vulkan_radv","rocm6_4_2","rocm7_beta","rocm7_rc"]
COL_NAMES = {
    "vulkan_amdvlk":"Vulkan (AMDVLK)",
    "vulkan_radv":"Vulkan (RADV)",
    "rocm6_4_2":"ROCm 6.4.2",
    "rocm7_beta":"ROCm 7.0 Beta",
    "rocm7_rc":"ROCm 7.0 RC",
}
WINNER = {
    "vulkan_amdvlk":"AMDVLK",
    "vulkan_radv":"RADV",
    "rocm6_4_2":"ROCm6.4.2",
    "rocm7_beta":"ROCm7 Beta",
    "rocm7_rc":"ROCm7 RC",
}

DEFAULT_MODELS = [
    ("Gemma3 12B Q8_0",                  "gemma-3-12b-it-UD-Q8_K_XL"),
    ("Gemma3 27B BF16",                  "gemma-3-27b-it-BF16"),
    ("Llama-4-Scout 17B Q8_0",           "Llama-4-Scout-17B-16E-Instruct-Q8_0"),
    ("Llama-4-Scout 17B Q4_K XL",        "Llama-4-Scout-17B-16E-Instruct-UD-Q4_K_XL"),
    ("Qwen3 30B BF16",                    "Qwen3-30B-A3B-BF16"),
    ("Qwen3-235B Q3_K XL",               "Qwen3-235B-A22B-Instruct-2507-UD-Q3_K_XL"),
    ("GLM-4.5-Air-UD-Q4_K_XL",           "GLM-4.5-Air-UD-Q4_K_XL"),
    ("GLM-4.5-Air-UD-Q6_K_XL",           "GLM-4.5-Air-UD-Q6_K_XL"),
    ("gpt-oss-120b-mxfp4",               "gpt-oss-120b-mxfp4"),
    ("gpt-oss-20b-mxfp4",                "gpt-oss-20b-mxfp4"),
]

CLEAN = lambda s: re.sub(r"-000\d+-of-000\d+", "", s)

def parse_logs():
    data = {}
    for p in glob.glob(os.path.join("results","*.log")):
        base = os.path.basename(p)[:-4]
        if "__" not in base:
            continue
        model_raw, env = base.split("__", 1)
        key = CLEAN(model_raw)
        t = open(p, errors="ignore").read()
        pp = PP_RE.search(t)
        tg = TG_RE.search(t)
        et = None
        if LOAD_ERR.search(t): et = "load"
        elif HANG_ERR.search(t): et = "hang"
        elif GEN_ERR.search(t) and not (pp and tg): et = "runtime"
        data.setdefault(key, {"pp512": {}, "tg128": {}})
        data[key]["pp512"][env] = {"mean": float(pp.group(1)) if (pp and et is None) else None,
                                   "error": et is not None, "etype": et}
        data[key]["tg128"][env] = {"mean": float(tg.group(1)) if (tg and et is None) else None,
                                   "error": et is not None, "etype": et}
    return data

def best(env_data):
    vals = {e:d["mean"] for e,d in env_data.items() if (not d["error"]) and d["mean"] is not None}
    return max(vals, key=vals.get) if vals else None

def cell(pp, tg):
    if (pp is None) or (tg is None):
        return "—"
    if pp["error"] or tg["error"]:
        m = pp["etype"] or tg["etype"] or "runtime"
        return {"load":"⚠️ Load Error","hang":"⚠️ GPU Hang","runtime":"⚠️ Runtime Error"}.get(m, "⚠️ Error")
    return f"{int(round(pp['mean']))} pp / {tg['mean']:.1f} tg"

def find_key(keys, prefix):
    for k in keys:
        if k.startswith(prefix):
            return k
    return None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("models", nargs="*", help="Optional model prefixes to include")
    args = ap.parse_args()
    data = parse_logs()
    want = [(m,m) for m in args.models] if args.models else DEFAULT_MODELS

    header = ["Model"] + [COL_NAMES[e] for e in ENV_ORDER] + ["🏆 Best PP","🏆 Best TG"]
    print("| " + " | ".join(header) + " |")
    print("|" + "|".join(["---"]*len(header)) + "|")

    for disp, patt in want:
        key = find_key(data.keys(), patt)
        row = [f"**{disp}**"]
        if not key:
            row += ["—"]*len(ENV_ORDER) + ["—","—"]
            print("| " + " | ".join(row) + " |")
            continue
        ppd, tgd = data[key]["pp512"], data[key]["tg128"]
        for env in ENV_ORDER:
            row.append(cell(ppd.get(env), tgd.get(env)))
        bpp, btg = best(ppd), best(tgd)
        row.append(f"🏆 **{WINNER[bpp]}**" if bpp else "—")
        row.append(f"🏆 **{WINNER[btg]}**" if btg else "—")
        print("| " + " | ".join(row) + " |")

if __name__ == "__main__":
    main()
