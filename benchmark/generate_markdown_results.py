#!/usr/bin/env python3
"""
gen_benchmarks_md.py — Generate Markdown for README + detailed benchmarks from results.json

Defaults:
- Input JSON: ../docs/results.json
- Outputs: ./README_benchmarks_section.md and ./benchmarks_generated.md
"""

from __future__ import annotations
import json
import argparse
import statistics as stats
from pathlib import Path
from collections import defaultdict
from typing import Dict, List, Tuple, Optional

# === ENV LABELS ===
ENV_LABEL: Dict[str, str] = {
    # ROCm 7 RC
    "rocm7_rc-rocwmma": "ROCm 7 RC + ROCWMMA + hipBLASLt",
    "rocm7_rc": "ROCm 7 RC (hipBLASLt)",
    "rocm7_rc-hblt0": "ROCm 7 RC (hipBLASLt OFF)",
    "rocm7_rc-rocwmma-hblt0": "ROCm 7 RC + ROCWMMA (hipBLASLt OFF)",

    # ROCm 6.4.4
    "rocm6_4_4": "ROCm 6.4.4 (hipBLASLt)",
    "rocm6_4_4-hblt0": "ROCm 6.4.4 (hipBLASLt OFF)",
    "rocm6_4_4-rocwmma": "ROCm 6.4.4 + ROCWMMA (hipBLASLt)",
    "rocm6_4_4-rocwmma-hblt0": "ROCm 6.4.4 + ROCWMMA (hipBLASLt OFF)",

    # Vulkan
    "vulkan_amdvlk": "Vulkan AMDVLK",
    "vulkan_radv": "Vulkan RADV",
}

TESTS = ["pp512", "tg128"]

def md_row(values: List[str]) -> str:
    return "| " + " | ".join(values) + " |"


def load_results(path: Path) -> Dict:
    data = json.loads(path.read_text())
    assert "runs" in data and isinstance(data["runs"], list), "results.json must have a top-level 'runs' list"
    return data


def envs_present(runs: List[Dict], only_env: Optional[List[str]], include_all_envs: bool) -> List[str]:
    present = {r.get("env") for r in runs if r.get("env")}
    if only_env:
        present = present.intersection(set(only_env))
    if include_all_envs:
        # Include even if not present (might appear 0 rows in tables)
        envs = [e for e in ENV_LABEL.keys() if (not only_env or e in only_env)]
    else:
        envs = [e for e in ENV_LABEL.keys() if e in present and (not only_env or e in only_env)]
    return envs


def fa_to_filter(fa: str) -> Optional[bool]:
    fa = fa.lower().strip()
    if fa == "on":
        return True
    if fa == "off":
        return False
    if fa == "any":
        return None
    raise ValueError("--fa must be on/off/any")


def margin_aware_placements(
    runs: List[Dict],
    envs: List[str],
    test_filter: str,
    fa_filter: Optional[bool]
) -> Tuple[Dict[str, Dict[str, int]], int]:
    """
    Returns (placements, sample_count)
    placements[env] -> {"first": n, "second": n, "third": n}
    sample_count = number of model+quant comparisons considered
    """
    placements = defaultdict(lambda: {"first": 0, "second": 0, "third": 0})
    # group by (model, quant)
    grouped = defaultdict(list)
    for r in runs:
        if r.get("error"):
            continue
        if r.get("test") != test_filter:
            continue
        if fa_filter is not None and r.get("fa") != fa_filter:
            continue
        if r.get("env") not in envs:
            continue
        key = (r.get("model_clean"), r.get("quant"))
        grouped[key].append(r)

    samples = 0
    for key, entries in grouped.items():
        # collate by env
        env_groups = defaultdict(list)
        for e in entries:
            env_groups[e["env"]].append(e)
        env_list = [e for e in envs if e in env_groups]  # keep requested order
        if len(env_list) < 2:
            continue

        # summarize median mean ± median err per env
        summary = {}
        for env in env_list:
            means = [x["tps_mean"] for x in env_groups[env] if x.get("tps_mean") is not None]
            errs = [x.get("tps_err", 0.0) or 0.0 for x in env_groups[env]]
            if not means:
                continue
            m = stats.median(means)
            e = stats.median(errs) if errs else 0.0
            summary[env] = (m - e, m + e, m)
        if len(summary) < 2:
            continue

        samples += 1

        # rank with overlap -> ties share rank
        remaining = [env for env, _ in sorted(summary.items(), key=lambda kv: kv[1][2], reverse=True)]
        assigned = {}
        current_rank = 1
        while remaining and current_rank <= 3:
            env0 = remaining[0]
            low0, high0, _ = summary[env0]
            tied = [env0]
            for env in remaining[1:]:
                low, high, _ = summary[env]
                if not (low > high0 or high < low0):  # overlap -> tie
                    tied.append(env)
            for env in tied:
                assigned[env] = current_rank
            remaining = [e for e in remaining if e not in tied]
            current_rank += 1

        for env, rk in assigned.items():
            if rk == 1:
                placements[env]["first"] += 1
            elif rk == 2:
                placements[env]["second"] += 1
            elif rk == 3:
                placements[env]["third"] += 1

    return placements, samples


def pairwise_win_counts(runs: List[Dict], envA: str, envB: str, test: str, fa_filter: Optional[bool]) -> Tuple[int, int, int, int]:
    A = {}
    B = {}
    for r in runs:
        if r.get("error") or r.get("test") != test:
            continue
        if fa_filter is not None and r.get("fa") != fa_filter:
            continue
        key = (r.get("model_clean"), r.get("quant"))
        if r.get("env") == envA:
            A[key] = r["tps_mean"]
        elif r.get("env") == envB:
            B[key] = r["tps_mean"]
    winsA = winsB = ties = 0
    for k in (set(A) & set(B)):
        if A[k] > B[k]:
            winsA += 1
        elif B[k] > A[k]:
            winsB += 1
        else:
            ties += 1
    total = winsA + winsB + ties
    return winsA, winsB, ties, total


def average_ranks(place_dict: Dict[str, Dict[str, int]]) -> Dict[str, Optional[float]]:
    avg = {}
    for env, c in place_dict.items():
        total = c.get("first", 0) + c.get("second", 0) + c.get("third", 0)
        if total == 0:
            avg[env] = None
        else:
            avg[env] = round((1 * c.get("first", 0) + 2 * c.get("second", 0) + 3 * c.get("third", 0)) / total, 2)
    return avg


def flash_attention_effect(runs: List[Dict], envs: List[str]) -> Dict[str, Dict[str, Dict[str, float]]]:
    """
    Returns: effects[env][test] = {n_pairs, median_pct, min, max}
    Based on paired model+quant runs (ON vs OFF).
    """
    model_pairs = defaultdict(lambda: defaultdict(dict))  # (env,test)->(model,quant)->{fa: tps}
    for r in runs:
        if r.get("error") or r.get("tps_mean") is None:
            continue
        if r.get("test") not in TESTS:
            continue
        if r.get("env") not in envs:
            continue
        model_key = (r.get("model_clean"), r.get("quant"))
        model_pairs[(r["env"], r["test"])][model_key][r.get("fa")] = r["tps_mean"]

    summary = defaultdict(dict)
    for (env, test), d in model_pairs.items():
        deltas = []
        for mk, vals in d.items():
            if True in vals and False in vals and vals[False] > 0:
                deltas.append((vals[True] - vals[False]) / vals[False] * 100.0)
        if deltas:
            summary[env][test] = {
                "n_pairs": len(deltas),
                "median_pct": round(stats.median(deltas), 1),
                "min": round(min(deltas), 1),
                "max": round(max(deltas), 1),
            }
    return summary


def rocwmma_effect(runs: List[Dict], pairs_to_compare: List[Tuple[str, str, str]], tests: List[str]) -> List[Tuple[str, str, str, str, int, float]]:
    """
    Compare ROCWMMA ON vs OFF with same hipBLASLt state.
    Returns rows of (context_label, test, env_on, env_off, n_pairs, median_delta_pct)
    where delta_pct = median(ON/OFF - 1)*100 over common model+quant.
    """
    rows = []
    for env_on, env_off, label in pairs_to_compare:
        for test in tests:
            data_on = defaultdict(list)
            data_off = defaultdict(list)
            for r in runs:
                if r.get("error") or r.get("test") != test:
                    continue
                if r.get("env") == env_on:
                    data_on[(r.get("model_clean"), r.get("quant"))].append(r["tps_mean"])
                elif r.get("env") == env_off:
                    data_off[(r.get("model_clean"), r.get("quant"))].append(r["tps_mean"])
            common = sorted(set(data_on) & set(data_off))
            if not common:
                continue
            ratios = []
            for k in common:
                aon = stats.median(data_on[k])
                aoff = stats.median(data_off[k])
                if aoff > 0:
                    ratios.append(aon / aoff - 1.0)
            if ratios:
                rows.append((label, test, env_on, env_off, len(ratios), round(100 * stats.median(ratios), 1)))
    return rows


def hipblaslt_effect(runs: List[Dict], pairs_to_compare: List[Tuple[str, str, str]], tests: List[str]) -> List[Tuple[str, str, str, str, int, float]]:
    """
    Compare hipBLASLt ON vs OFF with same ROCWMMA state.
    Returns rows of (context_label, test, env_on, env_off, n_pairs, median_delta_pct)
    where delta_pct = median(ON/OFF - 1)*100 over common model+quant.
    """
    rows = []
    for env_on, env_off, label in pairs_to_compare:
        for test in tests:
            data_on = defaultdict(list)
            data_off = defaultdict(list)
            for r in runs:
                if r.get("error") or r.get("test") != test:
                    continue
                if r.get("env") == env_on:
                    data_on[(r.get("model_clean"), r.get("quant"))].append(r["tps_mean"])
                elif r.get("env") == env_off:
                    data_off[(r.get("model_clean"), r.get("quant"))].append(r["tps_mean"])
            common = sorted(set(data_on) & set(data_off))
            if not common:
                continue
            ratios = []
            for k in common:
                aon = stats.median(data_on[k])
                aoff = stats.median(data_off[k])
                if aoff > 0:
                    ratios.append(aon / aoff - 1.0)
            if ratios:
                rows.append((label, test, env_on, env_off, len(ratios), round(100 * stats.median(ratios), 1)))
    return rows


def amdvlk_vs_radv(runs: List[Dict], fa_filter: Optional[bool]) -> List[Tuple[str, int, int, int, int]]:
    rows = []
    for test in TESTS:
        wa, wr, ties, total = pairwise_win_counts(runs, "vulkan_amdvlk", "vulkan_radv", test, fa_filter)
        rows.append((test, wa, wr, ties, total))
    return rows


def winners(place_dict: Dict[str, Dict[str, int]], slot="first") -> Tuple[List[str], int]:
    max_count = max((c.get(slot, 0) for c in place_dict.values()), default=0)
    win_list = [env for env, c in place_dict.items() if c.get(slot, 0) == max_count and max_count > 0]
    return win_list, max_count


def human_list(envs: List[str]) -> str:
    return ", ".join(ENV_LABEL.get(e, e) for e in envs) if envs else "—"


def build_readme_section(
    envs: List[str],
    pp_place: Dict[str, Dict[str, int]],
    tg_place: Dict[str, Dict[str, int]],
    fa_filter: Optional[bool]
) -> str:
    # Winners
    pp_wins, _ = winners(pp_place, "first")
    tg_wins, _ = winners(tg_place, "first")

    lines: List[str] = []
    lines.append("## 3. Performance Benchmarks (Key Results)")
    lines.append("")
    lines.append("🌐 Interactive exploration of the latest benchmark runs: [Interactie Benchmark Viewer](https://kyuz0.github.io/amd-strix-halo-toolboxes/)")
    lines.append("")
    lines.append("Benchmarks were analysed with **error-aware ties** (mean ± σ). If two backends overlap within margins, they are treated as a tie. All placement counts below use **Flash Attention ON**.")
    lines.append("")

    # Placement tables
    def place_table(title: str, place_dict: Dict[str, Dict[str, int]]):
        lines.append(f"**{title}**")
        lines.append(md_row(["Backend", "1st", "2nd", "3rd"]))
        lines.append(md_row(["---", "---:", "---:", "---:"]))
        order = sorted(place_dict.items(), key=lambda kv: (-kv[1].get("first", 0), -kv[1].get("second", 0), kv[0]))
        for env, c in order:
            lines.append(md_row([ENV_LABEL.get(env, env), str(c.get("first", 0)), str(c.get("second", 0)), str(c.get("third", 0))]))
        lines.append("")

    place_table("Prompt Processing (pp512)", pp_place)
    place_table("Token Generation (tg128)", tg_place)

    # Data-driven recommendations
    def total_score(c: Dict[str, int]) -> int:
        # weight 1st more than 2nd
        return c.get("first", 0) * 2 + c.get("second", 0)

    best_bal_score = -1
    balanced: List[str] = []
    for env in envs:
        score = total_score(pp_place.get(env, {})) + total_score(tg_place.get(env, {}))
        if score > best_bal_score:
            best_bal_score = score
            balanced = [env]
        elif score == best_bal_score:
            balanced.append(env)

    lines.append("### Summary & Recommendations")
    lines.append(f"- **Fastest prompt processing:** {human_list(pp_wins)} (most 1st-place finishes).")
    lines.append(f"- **Fastest token generation:** {human_list(tg_wins)} (most 1st-place finishes).")
    lines.append(f"- **Balanced choice:** {human_list(balanced)} (consistently near the top across PP/TG).")
    lines.append("")
    lines.append("> **Note (ROCm 7):** Toolboxes enable **hipBLASLt** by default. The benchmark suite also runs **hipBLASLt OFF** variants to show its impact.")
    return "\n".join(lines)


def build_benchmarks_doc(
    runs: List[Dict],
    envs: List[str],
    pp_place: Dict[str, Dict[str, int]],
    tg_place: Dict[str, Dict[str, int]],
    fa_filter: Optional[bool],
) -> str:
    lines: List[str] = []
    lines.append("# AMD Strix Halo — llama.cpp Toolboxes (Benchmarks)")
    lines.append("")
    lines.append("**Interactive results:** https://kyuz0.github.io/amd-strix-halo-toolboxes/")
    lines.append("")
    lines.append("## Table of Contents")
    lines.append("- [Benchmark methodology](#benchmark-methodology)")
    lines.append("- [Summary of current dataset (Flash Attention ON)](#summary-of-current-dataset-flash-attention-on)")
    lines.append("  - [Placement counts](#placement-counts)")
    lines.append("  - [Pairwise head-to-head wins](#pairwise-head-to-head-wins)")
    lines.append("  - [Average ranks](#average-ranks)")
    lines.append("- [Analyses by feature](#analyses-by-feature)")
    lines.append("  - [Impact of Flash Attention](#impact-of-flash-attention)")
    lines.append("  - [Impact of ROCWMMA](#impact-of-rocwmma)")
    lines.append("  - [Impact of hipBLASLt](#impact-of-hipblaslt)")
    lines.append("  - [Vulkan: AMDVLK vs RADV](#vulkan-amdvlk-vs-radv)")
    lines.append("- [Recommendations](#recommendations)")
    lines.append("- [Winner calculation](#winner-calculation)")
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## Benchmark methodology")
    lines.append("")
    lines.append("- **pp512** — prompt processing throughput (tokens/sec, prefill)")
    lines.append("- **tg128** — token generation throughput (tokens/sec, interactive)")
    lines.append("- Each backend tested twice per model: `-fa 0` and `-fa 1`")
    lines.append("- Winners per model/test are **margin-aware**; multiple winners are possible when mean±σ overlap")
    lines.append("- Built from the same llama.cpp commit for consistency")
    lines.append("")
    lines.append("**Backends in this dataset:** " + ", ".join(ENV_LABEL.get(e, e) for e in envs))
    lines.append("")
    lines.append("**ROCm 7 hipBLASLt policy:** Toolboxes ship with **hipBLASLt enabled** by default (`ROCBLAS_USE_HIPBLASLT=1`). The benchmark script also runs **hipBLASLt OFF** variants (`-hblt0`) to measure its effect.")
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## Summary of current dataset (Flash Attention ON)")
    lines.append("")
    # Placement counts
    lines.append("### Placement counts")
    def place_block(title: str, place_dict: Dict[str, Dict[str, int]]):
        lines.append(f"**{title}**")
        lines.append(md_row(["Backend", "1st", "2nd", "3rd"]))
        lines.append(md_row(["---", "---:", "---:", "---:"]))
        order = sorted(place_dict.items(), key=lambda kv: (-kv[1].get("first", 0), -kv[1].get("second", 0), kv[0]))
        for env, c in order:
            lines.append(md_row([ENV_LABEL.get(env, env), str(c.get("first", 0)), str(c.get("second", 0)), str(c.get("third", 0))]))
        lines.append("")
    place_block("Prompt Processing (pp512)", pp_place)
    place_block("Token Generation (tg128)", tg_place)

    # Pairwise wins
    lines.append("### Pairwise head-to-head wins")
    lines.append("For any model+quant where both backends succeeded, this counts who was faster (ties when equal).")
    lines.append(md_row(["Comparison", "Test", "A wins", "B wins", "Ties", "Total"]))
    lines.append(md_row(["---", "---", "---:", "---:", "---:", "---:"]))
    pairs = [
        ("ROCm 7 RC + ROCWMMA + hipBLASLt", "Vulkan AMDVLK", "rocm7_rc-rocwmma", "vulkan_amdvlk"),
        ("ROCm 7 RC + ROCWMMA + hipBLASLt", "Vulkan RADV", "rocm7_rc-rocwmma", "vulkan_radv"),
        ("Vulkan AMDVLK", "Vulkan RADV", "vulkan_amdvlk", "vulkan_radv"),
    ]
    for labelA, labelB, envA, envB in pairs:
        for test in TESTS:
            a, b, t, total = pairwise_win_counts(runs, envA, envB, test, fa_filter)
            lines.append(md_row([f"{labelA} vs {labelB}", test, str(a), str(b), str(t), str(total)]))
    lines.append("")

    # Average ranks
    lines.append("### Average ranks")
    avg_pp = average_ranks(pp_place)
    avg_tg = average_ranks(tg_place)
    lines.append("**Prompt Processing (pp512)**")
    lines.append(md_row(["Backend", "Avg Rank (↓ is better)"]))
    lines.append(md_row(["---", "---:"]))
    for env, val in sorted(avg_pp.items(), key=lambda kv: (kv[1] is None, kv[1] or 99)):
        lines.append(md_row([ENV_LABEL.get(env, env), str(val) if val is not None else "—"]))
    lines.append("")
    lines.append("**Token Generation (tg128)**")
    lines.append(md_row(["Backend", "Avg Rank (↓ is better)"]))
    lines.append(md_row(["---", "---:"]))
    for env, val in sorted(avg_tg.items(), key=lambda kv: (kv[1] is None, kv[1] or 99)):
        lines.append(md_row([ENV_LABEL.get(env, env), str(val) if val is not None else "—"]))
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## Analyses by feature")
    lines.append("")

    # Flash Attention effect
    lines.append("### Impact of Flash Attention")
    fa_eff = flash_attention_effect(runs, envs)
    lines.append("Median % change when **Flash Attention ON vs OFF**, paired by model+quant, per backend:")
    lines.append(md_row(["Backend", "pp512 Δ% (median, min..max, n)", "tg128 Δ% (median, min..max, n)"]))
    lines.append(md_row(["---", "---", "---"]))
    def fmt_eff(row: Optional[Dict[str, float]]) -> str:
        return f"{row['median_pct']}% ({row['min']}..{row['max']}), n={row['n_pairs']}" if row else "—"
    for env in envs:
        row_pp = fa_eff.get(env, {}).get("pp512")
        row_tg = fa_eff.get(env, {}).get("tg128")
        lines.append(md_row([ENV_LABEL.get(env, env), fmt_eff(row_pp), fmt_eff(row_tg)]))
    lines.append("")

    # ROCWMMA effect — check both ROCm 7 and 6.4.4 families if present
    lines.append("### Impact of ROCWMMA")
    rocwmma_pairs = []
    if "rocm7_rc-rocwmma" in envs and "rocm7_rc" in envs:
        rocwmma_pairs.append(("rocm7_rc-rocwmma", "rocm7_rc", "ROCm 7 RC (hipBLASLt)"))
    if "rocm7_rc-rocwmma-hblt0" in envs and "rocm7_rc-hblt0" in envs:
        rocwmma_pairs.append(("rocm7_rc-rocwmma-hblt0", "rocm7_rc-hblt0", "ROCm 7 RC (hipBLASLt OFF)"))
    if "rocm6_4_4-rocwmma" in envs and "rocm6_4_4" in envs:
        rocwmma_pairs.append(("rocm6_4_4-rocwmma", "rocm6_4_4", "ROCm 6.4.4 (hipBLASLt)"))
    if "rocm6_4_4-rocwmma-hblt0" in envs and "rocm6_4_4-hblt0" in envs:
        rocwmma_pairs.append(("rocm6_4_4-rocwmma-hblt0", "rocm6_4_4-hblt0", "ROCm 6.4.4 (hipBLASLt OFF)"))

    rocwmma_rows = rocwmma_effect(runs, rocwmma_pairs, TESTS)
    lines.append(md_row(["Context", "Test", "Compared Envs", "Pairs", "Median Δ%"]))
    lines.append(md_row(["---", "---", "---", "---:", "---:"]))
    for label, test, env_on, env_off, n, delta in rocwmma_rows:
        lines.append(md_row([label, test, f"{ENV_LABEL.get(env_on, env_on)} vs {ENV_LABEL.get(env_off, env_off)}", str(n), f"{delta}%"]))
    lines.append("")

    # hipBLASLt effect — for both ROCm 7 and 6.4.4 families
    lines.append("### Impact of hipBLASLt")
    hip_pairs = []
    if "rocm7_rc" in envs and "rocm7_rc-hblt0" in envs:
        hip_pairs.append(("rocm7_rc", "rocm7_rc-hblt0", "ROCm 7 RC (no ROCWMMA)"))
    if "rocm7_rc-rocwmma" in envs and "rocm7_rc-rocwmma-hblt0" in envs:
        hip_pairs.append(("rocm7_rc-rocwmma", "rocm7_rc-rocwmma-hblt0", "ROCm 7 RC + ROCWMMA"))
    if "rocm6_4_4" in envs and "rocm6_4_4-hblt0" in envs:
        hip_pairs.append(("rocm6_4_4", "rocm6_4_4-hblt0", "ROCm 6.4.4 (no ROCWMMA)"))
    if "rocm6_4_4-rocwmma" in envs and "rocm6_4_4-rocwmma-hblt0" in envs:
        hip_pairs.append(("rocm6_4_4-rocwmma", "rocm6_4_4-rocwmma-hblt0", "ROCm 6.4.4 + ROCWMMA"))

    hip_rows = hipblaslt_effect(runs, hip_pairs, TESTS)
    lines.append(md_row(["Context", "Test", "Compared Envs", "Pairs", "Median Δ%"]))
    lines.append(md_row(["---", "---", "---", "---:", "---:"]))
    for label, test, env_on, env_off, n, delta in hip_rows:
        lines.append(md_row([label, test, f"{ENV_LABEL.get(env_on, env_on)} vs {ENV_LABEL.get(env_off, env_off)}", str(n), f"{delta}%"]))
    lines.append("")

    # AMDVLK vs RADV
    lines.append("### Vulkan: AMDVLK vs RADV")
    lines.append("Head-to-head wins with selected Flash Attention filter:")
    lines.append(md_row(["Test", "AMDVLK wins", "RADV wins", "Ties", "Total"]))
    lines.append(md_row(["---", "---:", "---:", "---:", "---:"]))
    for test, wa, wr, t, total in amdvlk_vs_radv(runs, fa_filter):
        lines.append(md_row([test, str(wa), str(wr), str(t), str(total)]))
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## Recommendations")
    pp_wins, _ = winners(pp_place, "first")
    tg_wins, _ = winners(tg_place, "first")
    lines.append(f"- **Fastest prompt processing:** {human_list(pp_wins)} (most 1st-place finishes with selected Flash Attention filter).")
    lines.append(f"- **Fastest token generation:** {human_list(tg_wins)} (most 1st-place finishes with selected Flash Attention filter).")
    # Balanced: highest (2*first + second) across PP+TG
    def score(c: Dict[str, int]) -> int:
        return c.get("first", 0) * 2 + c.get("second", 0)
    best_bal = -1
    balanced: List[str] = []
    for env in envs:
        s = score(pp_place.get(env, {})) + score(tg_place.get(env, {}))
        if s > best_bal:
            best_bal = s
            balanced = [env]
        elif s == best_bal:
            balanced.append(env)
    lines.append(f"- **Balanced choice:** {human_list(balanced)} (consistently near the top across PP/TG).")
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## Winner calculation")
    lines.append("A backend is counted as a winner if its mean throughput is within the best backend’s pooled ± error margin for that model/test type. This treats results within measurement noise as ties instead of false losses.")
    return "\n".join(lines)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", type=Path, default=Path("../docs/results.json"),
                    help="Path to results.json (default: ../docs/results.json)")
    ap.add_argument("--out-readme", type=Path, default=Path("./README_benchmarks_section.md"),
                    help="Path to write README section Markdown (default: ./README_benchmarks_section.md)")
    ap.add_argument("--out-bench", type=Path, default=Path("./benchmarks_generated.md"),
                    help="Path to write detailed benchmarks Markdown (default: ./benchmarks_generated.md)")
    ap.add_argument("--fa", choices=["on", "off", "any"], default="on",
                    help="Flash Attention filter (default: on)")
    ap.add_argument("--include-all-envs", action="store_true",
                    help="Include envs even if not present in results.json")
    ap.add_argument("--only-env", action="append",
                    help="Restrict analysis to specific env keys (repeatable)")
    args = ap.parse_args()

    data = load_results(args.file)
    runs: List[Dict] = data["runs"]
    fa_filter = fa_to_filter(args.fa)
    envs = envs_present(runs, args.only_env, args.include_all_envs)

    pp_place, _ = margin_aware_placements(runs, envs, "pp512", fa_filter)
    tg_place, _ = margin_aware_placements(runs, envs, "tg128", fa_filter)

    readme_md = build_readme_section(envs, pp_place, tg_place, fa_filter)
    args.out_readme.write_text(readme_md)

    bench_md = build_benchmarks_doc(runs, envs, pp_place, tg_place, fa_filter)
    args.out_bench.write_text(bench_md)

    print(f"Wrote:\n - {args.out_readme}\n - {args.out_bench}")


if __name__ == "__main__":
    main()