#!/usr/bin/env python3
"""
Parse the console output of run_loadtime_benchmarks.sh stored in run_loadtime_benchmarks.log,
then produce a Markdown table of average load+inference times per model/env.
"""
import re
from collections import defaultdict, OrderedDict
import sys

LOGFILE = 'run_loadtime_benchmark.log'
# Define expected environments in desired column order
ENV_ORDER = ['vulkan_radv','vulkan_amdvlk','rocm6_4_2','rocm7_beta','rocm7_rc']

# Regex patterns
ENTRY_RE = re.compile(r"✔ \[(?P<env>[^]]+)\] (?P<model>[^ ]+) avg=(?P<avg>[0-9.]+)s over (?P<n>[0-9]+) runs")
FAIL_RE  = re.compile(r"✖ \[(?P<env>[^]]+)\] (?P<model>[^ ]+) all runs failed")

# Data containers
results = defaultdict(lambda: {})  # results[model][env] = float or 'ERR'

# Read and parse log
with open(LOGFILE) as f:
    for line in f:
        line = line.strip()
        m = ENTRY_RE.match(line)
        if m:
            env = m.group('env')
            model = m.group('model')
            avg = float(m.group('avg'))
            results[model][env] = avg
            continue
        m2 = FAIL_RE.match(line)
        if m2:
            env = m2.group('env')
            model = m2.group('model')
            results[model][env] = None  # indicate failure

# Compute winner per model: smallest time
md_lines = []
# Header
header = ['Model'] + [e.replace('_',' ').title() for e in ENV_ORDER] + ['Fastest']
md_lines.append('| ' + ' | '.join(header) + ' |')
md_lines.append('|' + '|'.join(['---']*len(header)) + '|')

for model in sorted(results, key=lambda s: s.lower()):
    row = [f"**{model}**"]
    env_times = results[model]
    # find fastest
    valid = {e:env_times[e] for e in ENV_ORDER if e in env_times and env_times[e] is not None}
    if valid:
        best_env = min(valid, key=lambda k: valid[k])
        fastest = f"🏆 **{best_env}**"
    else:
        fastest = '—'
    for env in ENV_ORDER:
        if env not in env_times:
            cell = '—'
        else:
            t = env_times[env]
            if t is None:
                cell = '⚠️ Fail'
            else:
                cell = f"{t:.2f}s"
        row.append(cell)
    row.append(fastest)
    md_lines.append('| ' + ' | '.join(row) + ' |')

# Print markdown
table = '\n'.join(md_lines)
print(table)

