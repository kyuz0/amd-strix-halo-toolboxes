#!/usr/bin/env python3
"""
MTP Benchmark — Multi-Token Prediction acceptance & throughput test.

Original: https://gist.github.com/am17an/228edfb84ed082aa88e3865d6fa27090
Author:   am17an (PR #22673 — llama.cpp MTP support)

Sends 9 diverse prompts to a running llama-server via the OpenAI-compatible
/v1/chat/completions endpoint and reports per-prompt and aggregate metrics:
  - predicted tokens, draft tokens, accepted drafts, acceptance rate, tok/s

Usage:
  # 1. Start llama-server (with or without MTP)
  llama-server -m model.gguf -np 1 --spec-type mtp --spec-draft-n-max 3

  # 2. Run benchmark
  python mtp-bench.py --url http://127.0.0.1:8080 --out results.json

  # 3. Compare two runs
  python mtp-bench.py --diff baseline.json mtp.json
"""
import argparse, json, sys, time
from urllib import request

PROMPTS = [
    {"name": "code_python",      "prompt": "Write a Python function that returns the n-th Fibonacci number using memoization. Include a docstring."},
    {"name": "code_cpp",         "prompt": "Write a C++ template function `clamp(x, lo, hi)` that returns x clamped to [lo, hi]. No std::clamp."},
    {"name": "explain_concept",  "prompt": "Explain how speculative decoding works in large language model inference, in three short paragraphs."},
    {"name": "summarize",        "prompt": "Summarize in two sentences: The Industrial Revolution began in Britain in the late 18th century, transforming manufacturing through mechanization, steam power, and the factory system. It spread to continental Europe and North America during the 19th century."},
    {"name": "qa_factual",       "prompt": "Q: What are the four fundamental forces of physics?\nA:"},
    {"name": "translation",      "prompt": "Translate to French: 'The quick brown fox jumps over the lazy dog.'"},
    {"name": "creative_short",   "prompt": "Write a four-line poem about an old lighthouse."},
    {"name": "stepwise_math",    "prompt": "Solve step by step: A train leaves station A at 60 km/h. Two hours later, a second train leaves the same station on the same track at 90 km/h. How long until the second train catches the first?"},
    {"name": "long_code_review", "prompt": (
        "You are reviewing a backend service that has been suffering intermittent latency spikes "
        "in production. Below is the relevant code and a description of the system. After reading "
        "carefully, produce a structured review with three sections: (1) likely root causes ranked "
        "by probability, (2) concrete code or configuration changes you would make first, "
        "(3) what telemetry you would add to confirm the diagnosis.\n\n"
        "System description: a Python FastAPI service in front of a Postgres 15 database, deployed "
        "as four replicas behind an nginx load balancer. Each request reads a user record, fetches "
        "their last 50 events from a partitioned events table, computes an aggregate score, writes "
        "the score back to the user row, and returns a JSON response. Average payload is 4 KB. "
        "p50 latency is 35 ms; p99 spikes to 1.8 seconds approximately every 90 seconds in a "
        "regular pattern. The spikes correlate with elevated Postgres CPU but not with elevated "
        "Postgres connection count. The application pool is sized at 20 connections per replica. "
        "PgBouncer is in front of Postgres in transaction pooling mode with a pool size of 50.\n\n"
        "Code excerpt — the hot endpoint:\n"
        "```python\n@app.post('/score/{user_id}')\nasync def score(user_id: int, payload: ScoreRequest):\n"
        "    async with db.transaction() as tx:\n        user = await tx.fetchrow(\n"
        "            'SELECT id, tier, last_score FROM users WHERE id = $1 FOR UPDATE',\n            user_id,\n        )\n"
        "        if user is None:\n            raise HTTPException(404)\n        events = await tx.fetch(\n"
        "            'SELECT type, weight, ts FROM events '\n            'WHERE user_id = $1 ORDER BY ts DESC LIMIT 50',\n            user_id,\n        )\n"
        "        new_score = compute_score(user['tier'], events, payload.signals)\n"
        "        await tx.execute(\n            'UPDATE users SET last_score = $1, updated_at = now() WHERE id = $2',\n            new_score, user_id,\n        )\n"
        "        await tx.execute(\n            'INSERT INTO score_history (user_id, score, ts) VALUES ($1, $2, now())',\n            user_id, new_score,\n        )\n"
        "    await cache.set(f'score:{user_id}', new_score, ex=300)\n"
        "    metrics.histogram('score.latency_ms').observe((time.time() - start) * 1000)\n"
        "    return {'user_id': user_id, 'score': new_score}\n```\n\n"
        "Schema notes: `users` is ~50M rows, `events` is partitioned by month with ~2B rows total "
        "and a btree index on `(user_id, ts DESC)`. `score_history` is unpartitioned, ~800M rows, "
        "with a single index on `user_id`. Postgres autovacuum is at default settings. There is "
        "a nightly batch job that rebuilds materialized views starting at 02:00 UTC; spikes occur "
        "throughout the day, not just during the batch window. Connection pooling metrics show "
        "PgBouncer waiting connections occasionally hit 8-12 during spikes but never saturate. "
        "CPU on the FastAPI replicas stays below 30% even during spikes. Network round-trip time "
        "between the application and Postgres is consistently 0.4 ms.\n\nBegin your review now."
    )},
]

def post(url, payload):
    req = request.Request(url, data=json.dumps(payload).encode(), headers={"Content-Type":"application/json"}, method="POST")
    with request.urlopen(req, timeout=300) as r:
        return json.loads(r.read())

def run(args):
    out = {"results": []}
    for p in PROMPTS:
        t0 = time.time()
        r = post(f"{args.url}/v1/chat/completions", {
            "model": "llama",
            "messages": [{"role": "user", "content": p["prompt"]}],
            "max_tokens": 192,
            "seed": 42,
        })
        wall = time.time() - t0
        # OpenAI-compatible endpoint: timings are in usage or top-level
        usage = r.get("usage", {}) or {}
        t = r.get("timings", {}) or {}
        predicted_n = usage.get("completion_tokens") or t.get("predicted_n")
        predicted_per_second = t.get("predicted_per_second") or (predicted_n / wall if wall > 0 else 0)
        rec = {"name": p["name"], "wall_s": round(wall,3),
               "predicted_n": predicted_n, "predicted_per_second": round(predicted_per_second, 2),
               "draft_n": t.get("draft_n",0), "draft_n_accepted": t.get("draft_n_accepted",0)}
        rec["accept_rate"] = round(rec["draft_n_accepted"]/rec["draft_n"],4) if rec["draft_n"] else None
        out["results"].append(rec)
        ar = f"{rec['accept_rate']:.3f}" if rec["accept_rate"] is not None else "n/a"
        print(f"  {rec['name']:<18} pred={rec['predicted_n']:>4} draft={rec['draft_n']:>4} acc={rec['draft_n_accepted']:>4} rate={ar} tok/s={rec['predicted_per_second']:.1f}")
    td  = sum(x["draft_n"] or 0 for x in out["results"])
    ta  = sum(x["draft_n_accepted"] or 0 for x in out["results"])
    tp  = sum(x["predicted_n"] or 0 for x in out["results"])
    tw  = sum(x["wall_s"] for x in out["results"])
    out["aggregate"] = {"n_requests": len(out["results"]), "total_predicted": tp, "total_draft": td, "total_draft_accepted": ta,
                        "aggregate_accept_rate": round(ta/td,4) if td else None, "wall_s_total": round(tw,2)}
    print("\nAggregate:", json.dumps(out["aggregate"], indent=2))
    if args.out:
        json.dump(out, open(args.out,"w"), indent=2); print("Wrote", args.out)

def diff(a, b):
    A, B = json.load(open(a)), json.load(open(b))
    print(f"{'metric':<24} {'A':>14} {'B':>14} {'delta':>10}")
    for k in ("aggregate_accept_rate","total_predicted","total_draft","total_draft_accepted","wall_s_total"):
        va, vb = A["aggregate"].get(k), B["aggregate"].get(k)
        if va is None or vb is None: print(f"{k:<24} {str(va):>14} {str(vb):>14}"); continue
        d = vb - va
        s = f"{d:>+10.4f}" if isinstance(d,float) else f"{d:>+10}"
        print(f"{k:<24} {va:>14} {vb:>14} {s}")
    by_a = {x["name"]: x for x in A["results"]}
    print("\n{:<20} {:>8} {:>8} {:>8}".format("prompt","A","B","delta"))
    for rb in B["results"]:
        ra = by_a.get(rb["name"]) or {}
        ar = ra.get("accept_rate") or 0; br = rb.get("accept_rate") or 0
        print(f"{rb['name']:<20} {ar:>8.3f} {br:>8.3f} {br-ar:>+8.3f}")

ap = argparse.ArgumentParser()
ap.add_argument("--url", default="http://127.0.0.1:8080")
ap.add_argument("--out")
ap.add_argument("--diff", nargs=2)
a = ap.parse_args()
if a.diff: diff(*a.diff)
else: run(a)
