#!/usr/bin/env python3
import re, glob, os

# This script parses llama-bench logs in 'results/' to produce
# Markdown tables for pp512 (prompt processing) and tg128 (text generation).

# Regex patterns to extract tokens/sec rows
PP_RE = re.compile(r"\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|\s*pp512\s*\|\s*([\d.]+)\s*±\s*([\d.]+)")
TG_RE = re.compile(r"\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|\s*tg128\s*\|\s*([\d.]+)\s*±\s*([\d.]+)")

# Patterns to classify errors
LOAD_ERR = re.compile(r"failed to load model|Device memory allocation.*failed", re.IGNORECASE)
HANG_ERR = re.compile(r"GPU Hang|HW Exception", re.IGNORECASE)
GENERIC_ERR = re.compile(r"error:|exit \d+", re.IGNORECASE)

# Env ordering
ENV_ORDER = ["vulkan_radv","vulkan_amdvlk","rocm6_4_2","rocm7_beta","rocm7_rc"]

data = {}

# Utility to clean model names
def clean_name(raw):
    return re.sub(r"-000\d+-of-000\d+", "", raw)

# Scan logs
glob_pattern = os.path.join("results", "*.log")
for path in sorted(glob.glob(glob_pattern)):
    # Fix: use rsplit, not rssplit
    base = os.path.basename(path).rsplit('.log',1)[0]
    if '__' not in base:
        continue
    model_raw, env = base.split('__',1)
    model = clean_name(model_raw)

    text = open(path, errors='ignore').read()
    # Determine error type
    if LOAD_ERR.search(text):
        err_type = 'load'
    elif HANG_ERR.search(text):
        err_type = 'hang'
    elif GENERIC_ERR.search(text) and not (PP_RE.search(text) and TG_RE.search(text)):
        err_type = 'runtime'
    else:
        err_type = None

    # Extract performance if no load error
    pp_match = PP_RE.search(text) if err_type is None else None
    tg_match = TG_RE.search(text) if err_type is None else None

    for key, match in [('pp512', pp_match), ('tg128', tg_match)]:
        cell = {
            'mean': match.group(1) if match else None,
            'std':  match.group(2) if match else None,
            'error': err_type is not None,
            'etype': err_type
        }
        data.setdefault(model, {}).setdefault(key, {})[env] = cell

# Select winner
def pick_winner(env_data):
    scores = {e: float(d['mean']) for e,d in env_data.items() if not d['error'] and d['mean']}
    if not scores:
        return '—'
    best = max(scores, key=scores.get)
    others = [v for k,v in scores.items() if k!=best]
    tag = f"🏆 **{best}**"
    if others:
        gain = (scores[best]/max(others)-1)*100
        tag += f" (+{gain:.0f}%)"
    return tag

# Render table with distinct error messages
def render_table(test_label, display_name):
    print(f"### {display_name} — tokens/second\n")
    header = ['Model'] + [e.replace('_',' ').title() for e in ENV_ORDER] + ['Winner']
    print("| " + " | ".join(header) + " |")
    print("|" + "|".join(['---']*len(header)) + "|")

    for model in sorted(data, key=lambda s: s.lower()):
        row = [f"**{model}**"]
        env_data = data[model].get(test_label, {})
        for env in ENV_ORDER:
            d = env_data.get(env)
            if not d:
                cell = '—'
            elif d['error']:
                et = d['etype']
                if et=='load':
                    cell = '⚠️ Load Error'
                elif et=='hang':
                    cell = '⚠️ GPU Hang'
                else:
                    cell = '⚠️ Runtime Error'
            else:
                cell = f"{float(d['mean']):.2f} ± {float(d['std']):.2f}"
            row.append(cell)
        row.append(pick_winner(env_data))
        print("| " + " | ".join(row) + " |")
    print()

# Output tables
render_table('pp512','Prompt Processing (pp512)')
render_table('tg128','Text Generation (tg128)')

# Summary of failures by type
fail_lines = []
for model in sorted(data, key=lambda s: s.lower()):
    for test_label, envs in data[model].items():
        for env,d in envs.items():
            if d['error']:
                et = d['etype'] or 'unknown'
                desc = {
                    'load':'failed to load',
                    'hang':'GPU hang',
                    'runtime':'runtime error',
                }.get(et, 'error')
                fail_lines.append(f"- **{model}** [{test_label}] on *{env}*: {desc}")
if fail_lines:
    print("## Failed Runs\n")
    print("\n".join(fail_lines))    