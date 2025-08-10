# AMD Strix Halo — llama.cpp Toolboxes (Benchmarks)

**Interactive results:** [https://kyuz0.github.io/amd-strix-halo-toolboxes/](https://kyuz0.github.io/amd-strix-halo-toolboxes/)

* Filter by model name, size, and quantization
* Select backends with or without **Flash Attention**
* Compare pp512 and tg128 side-by-side
* Winners are computed using an **error-aware tolerance rule** — if two results overlap within their ± error margins, both are counted as winners.

---

## Benchmark methodology

* **pp512** — prompt processing throughput (tokens/sec, prefill)
* **tg128** — token generation throughput (tokens/sec, interactive)
* Each backend tested twice per model:

  * **Flash Attention OFF:** `-fa 0`
  * **Flash Attention ON:**  `-fa 1`
* Winners are determined per model using pooled ± error from all relevant runs; multiple winners are possible.
* All runs were built from the same `llama.cpp` commit for consistency.

**Tested backends:**

* Vulkan RADV
* Vulkan AMDVLK
* ROCm 6.4.2
* ROCm 6.4.2 + ROCWMMA
* ROCm 7.x (beta / RC)
* ROCm 7.x + ROCWMMA + hipBLASLt

**Note on ROCm 7 hipBLASLt:**
All ROCm 7 toolboxes ship with **hipBLASLt enabled by default** (`ROCBLAS_USE_HIPBLASLT=1`) because it improves performance and stability in most cases.
However, the benchmark script also includes runs with **hipBLASLt disabled** (`-hblt0`) so we can measure the impact directly.

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

## Summary of current dataset (margin-aware, Flash Attention ON)

### Prompt Processing (pp512)

* **ROCm 7 RC + ROCWMMA + hipBLASLt** dominates — **15 wins/ties** out of 22 models.
* **Vulkan AMDVLK** is second most frequent winner (**4 wins/ties**) but can’t load certain architectures due to the ≤ 2 GiB single-buffer limit.
* **Vulkan RADV** rarely wins in PP but is highly stable.

### Token Generation (tg128)

* **Vulkan RADV** leads — **13 wins/ties** out of 15 possible.
* **Vulkan AMDVLK** is a strong second, usually just behind RADV in TG.
* **ROCm 7 RC + ROCWMMA + hipBLASLt** generally lags in TG but still posts competitive results for some models.

---

### Placement counts (margin-aware, Flash Attention ON)

**Prompt Processing (pp512)**

| Backend                         |    1st | 2nd | 3rd |
| ------------------------------- | -----: | --: | --: |
| ROCm 7 RC + ROCWMMA + hipBLASLt | **15** |   2 |   1 |
| Vulkan AMDVLK                   |      4 |   5 |   1 |
| Vulkan RADV                     |      0 |   2 |   2 |

**Token Generation (tg128)**

| Backend                         |    1st | 2nd | 3rd |
| ------------------------------- | -----: | --: | --: |
| Vulkan RADV                     | **13** |   1 |   1 |
| Vulkan AMDVLK                   |      1 |  10 |   1 |
| ROCm 7 RC + ROCWMMA + hipBLASLt |      1 |   1 |   6 |

---

## Flash Attention

* **ROCm 7 RC + ROCWMMA + hipBLASLt** benefits noticeably from Flash Attention ON in prompt processing, with no stability penalties recorded.
* **Vulkan AMDVLK** and **Vulkan RADV** show mixed changes — some models improve with FA, others slow down slightly.
* FA should be enabled or disabled **per model/backend** based on measured performance.

---

## Recommendations

* **Fastest prompt processing:** ROCm 7 RC + ROCWMMA + hipBLASLt (Flash Attention ON)
* **Fastest token generation:** Vulkan RADV (Flash Attention ON)
* **Balanced performance:** Vulkan AMDVLK (fast PP & decent TG, but ≤ 2 GiB buffer limit)
* **BF16 models:** ROCm 7 RC + ROCWMMA + hipBLASLt (best ROCm PP/TG combo, stable with FA ON)
* **Maximum stability:** Vulkan RADV

---

## Winner calculation

A backend is counted as a winner if its mean throughput is within the best backend’s pooled ± error margin for that model/test type. This ensures results within measurement noise are treated as ties, not false losses.
