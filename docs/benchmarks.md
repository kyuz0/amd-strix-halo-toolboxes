# AMD Strix Halo — llama.cpp Toolboxes (Benchmarks)

**Live results:** [https://kyuz0.github.io/amd-strix-halo-toolboxes/](https://kyuz0.github.io/amd-strix-halo-toolboxes/)

- Filter by model name, size, and quantization
- Select backends with or without **Flash Attention (FA)**
- Compare pp512 and tg128 side-by-side
- Winners are computed with an error-aware tolerance rule.

---

## Benchmark methodology

* **pp512** — prompt processing throughput (tokens/sec)
* **tg128** — text generation throughput (tokens/sec)
* Each backend tested twice:

  * FA off: `-fa 0`
  * FA on:  `-fa 1`
* Winners determined per model using pooled ± error from both results; multiple winners are possible.

Tested backends:

* Vulkan RADV
* Vulkan AMDVLK
* ROCm 6.4.2
* ROCm 6.4.2 + rocWMMA
* ROCm 7.x (beta / rc)

All runs built from the same llama.cpp commit.

---

## Running benchmarks

Place `.gguf` models in `models/` (for sharded models, include only the first shard: `*-00001-of-*.gguf`).
Run:

```bash
benchmark/run_benchmarks.sh
```

This will:

* Detect models
* Execute each backend twice (FA off / FA on)
* Save logs in `benchmark/results/`

Generate `results.json` for analysis:

```bash
python benchmark/parse_results_to_json.py
```

Optional: print summary statistics:

```bash
python benchmark/summarize_results.py
```

---

## Summary of current dataset

### pp512 (prompt processing)

* **Vulkan AMDVLK** leads in average throughput and most frequent wins.

  * Winner count: AMDVLK (FA on) – 11 models; AMDVLK (FA off) – 3 models.
  * Average t/s: AMDVLK (FA off) – 422.46; AMDVLK (FA on) – 388.68.
* **Vulkan RADV** is competitive and shows wins on multiple models.

  * Winner count: RADV (FA on) – 3 models.
  * Average t/s: RADV (FA on) – 279.95; RADV (FA off) – 273.54.
* **ROCm 6.4.2 + rocWMMA** is strong in some cases.

  * Winner count: 2 models (FA on).
  * Average t/s: rocWMMA (FA on) – 335.44.
* ROCm 7.x variants trail in pp512 averages.

**Conclusion:** AMDVLK is generally fastest for prompt processing. RADV is close on certain models and is less prone to instability. ROCm+rocWMMA can match or exceed in select cases but is inconsistent.

---

### tg128 (text generation)

* **Vulkan RADV** shows the most frequent wins.

  * Winner count: RADV (FA off) – 6 models; RADV (FA on) – 5 models.
  * Average t/s: RADV (FA off) – 23.73; RADV (FA on) – 23.45.
* **Vulkan AMDVLK** wins in some cases but is less dominant than in pp512.

  * Winner count: AMDVLK (FA off) – 4 models.
  * Average t/s: AMDVLK (FA off) – 25.91; AMDVLK (FA on) – 23.85.
* **ROCm 6.4.2 + rocWMMA** achieves the highest average t/s.

  * Average t/s: rocWMMA (FA on) – 32.51; rocWMMA (FA off) – 31.96.
* ROCm 7.x and ROCm 6.4.2 also appear among winners in several models.

**Conclusion:** RADV is the most consistent for text generation wins. ROCm+rocWMMA delivers the highest averages but with potential stability issues. AMDVLK is competitive but not consistently ahead.

---

## Flash Attention (FA)

FA effects vary:

* In pp512 averages, AMDVLK performs better without FA.
* In tg128, the effect depends on backend and model.
  FA should be treated as a per-model tuning parameter rather than enabled or disabled globally.

---

## Recommendations

* **Stability priority:** Vulkan RADV.
* **Maximum pp512 throughput:** Vulkan AMDVLK, validate per model.
* **High tg128 averages:** ROCm 6.4.2 + rocWMMA, test stability.
* **FA setting:** Evaluate per model/backend using side-by-side comparison.

---

## Winner calculation

A backend is a winner if its mean throughput is within the best backend’s pooled ± error margin for that model and test type.
