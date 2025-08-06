# 1. Benchmark Results: Strix Halo Llama.cpp Toolboxes

This document presents comprehensive benchmarks of all supported Llama.cpp containers and backends, focusing on real GPU workloads and model loading times on the AMD Ryzen AI Max 395 "Strix Halo" iGPU.

## 2. Benchmark Methodology

Benchmarks cover both end-to-end performance (prompt processing and text generation) and model load times. Model load time benchmarks (llama-cli) are averaged over three runs per environment; inference benchmarks (llama-bench) use default tool settings.

Backends tested:

* **Vulkan RADV** (open source Vulkan driver)
* **Vulkan AMDVLK** (official AMD open Vulkan driver)
* **ROCm 6.4.2** (AMD's compute stack)
* **ROCm 7.0 beta** (AMD's compute stack)
* **ROCm 7.0 rc** (AMD's compute stack)

### 2.1. Llama.cpp Inference Benchmarks

#### 2.1.1. Script: `run_benchmarks.sh`

This script runs each model through every container/backend using the `llama-bench` tool.

##### Command Used

```bash
llama-bench -ngl 99 -mmp 0 -m /path/to/model.gguf
```

* `-ngl 99` — Use all available GPU layers
* `-mmp 0` — Disable mmap (required for ROCm to avoid extremely slow loads for models >64GB, and also improves speed for Vulkan drivers)
* `-m` — Path to the GGUF model file

Script location: `benchmark/run_benchmarks.sh`
Benchmark logs: `benchmark/results/`

##### Model Location

All scripts expect models in the `models/` directory (absolute path is recommended). For sharded models, the first shard must be present and named according to the GGUF naming convention (`*-00001-of-00002.gguf`).

### Prompt Processing (pp512) — tokens/second

| Model | Host | Rocm6 4 2 | Rocm7 Beta | Rocm7 Rc | Vulkan Amdvlk | Vulkan Radv | Winner |
|---|---|---|---|---|---|---|---|
| **gemma-3-12b-it-UD-Q8_K_XL** | — | 223.36 ± 0.23 | 222.95 ± 0.15 | 222.99 ± 0.24 | 683.07 ± 1.03 | 508.55 ± 0.90 | 🏆 **vulkan_amdvlk** (+34%) |
| **gemma-3-27b-it-BF16** | — | 88.73 ± 0.50 | 82.31 ± 0.29 | 83.18 ± 0.41 | ⚠️ Load Error | 135.40 ± 0.29 | 🏆 **vulkan_radv** (+53%) |
| **gemma-3-4b-it-Q3_K_S** | — | 729.02 ± 0.82 | 729.93 ± 1.29 | 728.63 ± 1.23 | 1616.55 ± 4.61 | 1520.07 ± 5.39 | 🏆 **vulkan_amdvlk** (+6%) |
| **GLM-4.5-Air-UD-Q4_K_XL** | — | ⚠️ Runtime Error | ⚠️ GPU Hang | 129.20 ± 0.38 | 199.54 ± 0.38 | 128.00 ± 0.23 | 🏆 **vulkan_amdvlk** (+54%) |
| **GLM-4.5-Air-UD-Q6_K_XL** | — | 124.86 ± 0.54 | ⚠️ GPU Hang | ⚠️ Runtime Error | 221.02 ± 0.58 | 126.86 ± 0.40 | 🏆 **vulkan_amdvlk** (+74%) |
| **gpt-oss-120b-F16** | — | ⚠️ GPU Hang | 357.68 ± 1.49 | 355.47 ± 0.55 | 449.22 ± 1.12 | 230.32 ± 0.72 | 🏆 **vulkan_amdvlk** (+26%) |
| **gpt-oss-120b-mxfp4** | — | 352.53 ± 1.06 | ⚠️ GPU Hang | 351.08 ± 0.86 | 485.98 ± 2.23 | 239.16 ± 1.26 | 🏆 **vulkan_amdvlk** (+38%) |
| **gpt-oss-20b-F32** | — | 323.64 ± 4.29 | 324.15 ± 3.76 | 324.27 ± 5.39 | 369.86 ± 1.57 | 318.82 ± 1.63 | 🏆 **vulkan_amdvlk** (+14%) |
| **gpt-oss-20b-mxfp4** | — | 580.67 ± 2.03 | 584.04 ± 2.48 | 584.15 ± 2.11 | 1206.08 ± 8.80 | 646.77 ± 4.63 | 🏆 **vulkan_amdvlk** (+86%) |
| **Kimi-Dev-72B-UD-Q8_K_XL** | — | ⚠️ GPU Hang | ⚠️ GPU Hang | ⚠️ Runtime Error | ⚠️ Load Error | 76.48 ± 0.23 | 🏆 **vulkan_radv** |
| **Llama-3.3-70B-Instruct-UD-Q8_K_XL** | — | 33.17 ± 0.07 | ⚠️ GPU Hang | ⚠️ Runtime Error | 96.23 ± 0.16 | 79.71 ± 0.13 | 🏆 **vulkan_amdvlk** (+21%) |
| **Llama-4-Scout-17B-16E-Instruct-Q6_K** | — | 121.52 ± 0.98 | ⚠️ GPU Hang | 135.36 ± 0.39 | 243.19 ± 1.20 | 137.97 ± 0.99 | 🏆 **vulkan_amdvlk** (+76%) |
| **Llama-4-Scout-17B-16E-Instruct-Q8_0** | — | ⚠️ GPU Hang | ⚠️ GPU Hang | ⚠️ Runtime Error | 238.93 ± 2.89 | 145.86 ± 2.44 | 🏆 **vulkan_amdvlk** (+64%) |
| **Llama-4-Scout-17B-16E-Instruct-UD-Q4_K_XL** | — | 132.66 ± 0.56 | 133.71 ± 0.64 | ⚠️ Runtime Error | 208.84 ± 1.35 | 133.49 ± 1.83 | 🏆 **vulkan_amdvlk** (+56%) |
| **llama3.3-70.6B-Q4_K_M** | — | 33.89 ± 0.03 | 33.91 ± 0.04 | 33.82 ± 0.05 | 72.75 ± 0.03 | 79.12 ± 0.14 | 🏆 **vulkan_radv** (+9%) |
| **Qwen3-235B-A22B-Instruct-2507-UD-Q3_K_XL** | — | 69.48 ± 0.09 | ⚠️ GPU Hang | 74.69 ± 0.17 | 99.94 ± 0.91 | 58.40 ± 0.21 | 🏆 **vulkan_amdvlk** (+34%) |
| **Qwen3-30B-A3B-BF16** | — | 157.74 ± 2.65 | 151.25 ± 3.33 | 154.95 ± 1.58 | 90.91 ± 0.35 | 71.16 ± 0.92 | 🏆 **rocm6_4_2** (+2%) |
| **Qwen3-Coder-30B-A3B-Instruct-BF16** | — | 150.53 ± 1.83 | 147.31 ± 2.22 | 144.59 ± 3.08 | 90.38 ± 0.57 | 71.53 ± 1.06 | 🏆 **rocm6_4_2** (+2%) |

### Text Generation (tg128) — tokens/second

| Model | Host | Rocm6 4 2 | Rocm7 Beta | Rocm7 Rc | Vulkan Amdvlk | Vulkan Radv | Winner |
|---|---|---|---|---|---|---|---|
| **gemma-3-12b-it-UD-Q8_K_XL** | — | 13.81 ± 0.00 | 13.80 ± 0.00 | 13.81 ± 0.00 | 13.84 ± 0.02 | 13.65 ± 0.02 | 🏆 **vulkan_amdvlk** (+0%) |
| **gemma-3-27b-it-BF16** | — | 4.02 ± 0.00 | 3.99 ± 0.01 | 3.99 ± 0.00 | ⚠️ Load Error | 3.98 ± 0.00 | 🏆 **rocm6_4_2** (+1%) |
| **gemma-3-4b-it-Q3_K_S** | — | 76.04 ± 0.03 | 76.52 ± 0.03 | 75.59 ± 0.03 | 83.89 ± 0.22 | 85.93 ± 0.09 | 🏆 **vulkan_radv** (+2%) |
| **GLM-4.5-Air-UD-Q4_K_XL** | — | ⚠️ Runtime Error | ⚠️ GPU Hang | 19.61 ± 0.00 | 22.75 ± 0.01 | 22.88 ± 0.02 | 🏆 **vulkan_radv** (+1%) |
| **GLM-4.5-Air-UD-Q6_K_XL** | — | 15.27 ± 0.00 | ⚠️ GPU Hang | ⚠️ Runtime Error | 16.47 ± 0.01 | 16.76 ± 0.00 | 🏆 **vulkan_radv** (+2%) |
| **gpt-oss-120b-F16** | — | ⚠️ GPU Hang | 33.70 ± 0.01 | 33.65 ± 0.00 | 33.49 ± 0.05 | 33.06 ± 0.02 | 🏆 **rocm7_beta** (+0%) |
| **gpt-oss-120b-mxfp4** | — | 43.56 ± 0.00 | ⚠️ GPU Hang | 44.63 ± 0.03 | 48.09 ± 0.04 | 48.93 ± 0.06 | 🏆 **vulkan_radv** (+2%) |
| **gpt-oss-20b-F32** | — | 26.64 ± 0.06 | 26.90 ± 0.00 | 26.86 ± 0.00 | 8.59 ± 0.01 | 7.77 ± 0.01 | 🏆 **rocm7_beta** (+0%) |
| **gpt-oss-20b-mxfp4** | — | 64.26 ± 0.01 | 64.37 ± 0.01 | 64.38 ± 0.01 | 68.90 ± 0.18 | 69.82 ± 0.03 | 🏆 **vulkan_radv** (+1%) |
| **Kimi-Dev-72B-UD-Q8_K_XL** | — | ⚠️ GPU Hang | ⚠️ GPU Hang | ⚠️ Runtime Error | ⚠️ Load Error | 2.65 ± 0.00 | 🏆 **vulkan_radv** |
| **Llama-3.3-70B-Instruct-UD-Q8_K_XL** | — | 2.72 ± 0.00 | ⚠️ GPU Hang | ⚠️ Runtime Error | 2.72 ± 0.00 | 2.72 ± 0.00 | 🏆 **rocm6_4_2** (+0%) |
| **Llama-4-Scout-17B-16E-Instruct-Q6_K** | — | 14.28 ± 0.00 | ⚠️ GPU Hang | 14.29 ± 0.00 | 15.28 ± 0.03 | 15.07 ± 0.05 | 🏆 **vulkan_amdvlk** (+1%) |
| **Llama-4-Scout-17B-16E-Instruct-Q8_0** | — | ⚠️ GPU Hang | ⚠️ GPU Hang | ⚠️ Runtime Error | 12.25 ± 0.01 | 12.27 ± 0.00 | 🏆 **vulkan_radv** (+0%) |
| **Llama-4-Scout-17B-16E-Instruct-UD-Q4_K_XL** | — | 17.29 ± 0.00 | 17.35 ± 0.00 | ⚠️ Runtime Error | 20.06 ± 0.01 | 19.99 ± 0.01 | 🏆 **vulkan_amdvlk** (+0%) |
| **llama3.3-70.6B-Q4_K_M** | — | 4.59 ± 0.00 | 4.60 ± 0.00 | 4.52 ± 0.00 | 5.01 ± 0.00 | 4.97 ± 0.00 | 🏆 **vulkan_amdvlk** (+1%) |
| **Qwen3-235B-A22B-Instruct-2507-UD-Q3_K_XL** | — | 13.54 ± 0.01 | ⚠️ GPU Hang | 13.56 ± 0.00 | 15.72 ± 0.01 | 16.29 ± 0.01 | 🏆 **vulkan_radv** (+4%) |
| **Qwen3-30B-A3B-BF16** | — | 22.88 ± 0.01 | 23.80 ± 0.09 | 23.08 ± 0.08 | 7.96 ± 0.03 | 7.33 ± 0.00 | 🏆 **rocm7_beta** (+3%) |
| **Qwen3-Coder-30B-A3B-Instruct-BF16** | — | 22.13 ± 0.00 | 24.12 ± 0.06 | 23.48 ± 0.01 | 8.00 ± 0.03 | 7.34 ± 0.01 | 🏆 **rocm7_beta** (+3%) |

##### Error Legend

* `⚠️ Load Error` — Model failed to load in this environment (usually OOM or driver error)
* `⚠️ GPU Hang` — GPU hung during inference (may work outside stress test)
* `⚠️ Runtime Error` — Miscellaneous runtime failure (check logs)

### 2.2. Model Loading Time Benchmarks

#### 2.2.1. Script: `run_loadtime_benchmark.sh`

This script benchmarks **model load + single-token inference** (using `llama-cli`) for every backend, using a minimal prompt. Three runs per combination are averaged.

##### Command Used

```bash
llama-cli -ngl 999 -fa --no-mmap -no-cnv -n 1 -m /path/to/model.gguf -p "Hello"
```

* `-ngl 999` — Use all available GPU layers
* `-fa` — Enable fast attention (default for most GPU builds)
* `--no-mmap` — Disable mmap (ensures all RAM usage is counted)
* `-no-cnv` — Disable convolution (relevant for some models)
* `-n 1` — Generate only one token (measures load + first inference)
* `-m` — Path to GGUF model
* `-p` — Prompt text ("Hello")

Script location: `benchmark/run_loadtime_benchmark.sh`
Logs: `benchmark/loadtime_results/`

#### 2.2.2. Results: Model Load + First Token (Seconds, Lower is Better)

| Model | Vulkan Radv | Vulkan Amdvlk | Rocm6 4 2 | Rocm7 Beta | Rocm7 Rc | Fastest |
|---|---|---|---|---|---|---|
| **gemma-3-12b-it-UD-Q8_K_XL** | 4.29s | 3.96s | 6.69s | 3.43s | 3.86s | 🏆 **rocm7_beta** |
| **gemma-3-27b-it-BF16-00001-of-00002** | 13.58s | ⚠️ Fail | 12.49s | 10.49s | 10.42s | 🏆 **rocm7_rc** |
| **Kimi-Dev-72B-UD-Q8_K_XL-00001-of-00002** | 30.59s | ⚠️ Fail | 35.30s | 30.02s | 26.36s | 🏆 **rocm7_rc** |
| **Llama-3.3-70B-Instruct-UD-Q8_K_XL-00001-of-00002** | 30.38s | 30.60s | 31.00s | 32.80s | 32.91s | 🏆 **vulkan_radv** |
| **Llama-4-Scout-17B-16E-Instruct-Q6_K-00001-of-00002** | 32.81s | 35.54s | 31.79s | 28.22s | 28.43s | 🏆 **rocm7_beta** |
| **Llama-4-Scout-17B-16E-Instruct-Q8_0-00001-of-00003** | 41.63s | 47.97s | 40.74s | 36.40s | 35.74s | 🏆 **rocm7_rc** |
| **Llama-4-Scout-17B-16E-Instruct-UD-Q4_K_XL-00001-of-00002** | 20.05s | 16.75s | 15.78s | ⚠️ Fail | 19.36s | 🏆 **rocm6_4_2** |
| **llama3.3-70.6B-Q4_K_M** | 8.82s | 9.18s | 9.89s | 9.34s | 14.60s | 🏆 **vulkan_radv** |
| **Qwen3-235B-A22B-Instruct-2507-UD-Q3_K_XL-00001-of-00003** | 40.72s | 44.88s | 39.06s | 35.39s | 33.46s | 🏆 **rocm7_rc** |
| **Qwen3-30B-A3B-BF16-00001-of-00002** | 14.76s | 12.94s | 22.17s | 15.93s | 22.67s | 🏆 **vulkan_amdvlk** |
| **Qwen3-Coder-30B-A3B-Instruct-BF16-00001-of-00002** | 14.02s | 12.94s | 17.78s | 14.39s | 16.16s | 🏆 **vulkan_amdvlk** |

##### Error Legend

* `⚠️ Fail` — Model failed to load (OOM or crash). May succeed if not under stress/test conditions.

---

## 3. Interpreting the Results & Caveats

* **Vulkan AMDVLK** generally gives the best performance for small/medium models, but ROCm 7.x improves as model size increases.
* **Vulkan RADV** is highly reliable and competitive on large models (esp. if AMDVLK fails to load).
* **ROCm** (especially 7.0 RC) delivers the fastest load times for the largest models.
* Many models that fail under `llama-bench` (e.g., due to GPU hangs or OOM) can sometimes still run interactively (especially outside a stress-test context).

## 4. How to Reproduce These Benchmarks

* Place all GGUF models in your `models/` directory.
* Use the scripts from the `benchmark/` folder:

  * `run_benchmarks.sh` for inference throughput
  * `run_loadtime_benchmark.sh` for loading times
* Output logs and tables will be written in `benchmark/results/` and `benchmark/loadtime_results/`.

