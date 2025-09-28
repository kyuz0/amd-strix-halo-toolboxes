# AMD Strix Halo — llama.cpp Toolboxes (Benchmarks)

**Interactive results:** https://kyuz0.github.io/amd-strix-halo-toolboxes/

## Table of Contents
- [Benchmark methodology](#benchmark-methodology)
- [Summary of current dataset (Flash Attention ON)](#summary-of-current-dataset-flash-attention-on)
  - [Placement counts](#placement-counts)
  - [Pairwise head-to-head wins](#pairwise-head-to-head-wins)
  - [Average ranks](#average-ranks)
- [Analyses by feature](#analyses-by-feature)
  - [Impact of Flash Attention](#impact-of-flash-attention)
  - [Impact of ROCWMMA](#impact-of-rocwmma)
  - [Impact of hipBLASLt](#impact-of-hipblaslt)
  - [Vulkan: AMDVLK vs RADV](#vulkan-amdvlk-vs-radv)
- [Recommendations](#recommendations)
- [Winner calculation](#winner-calculation)

---

## Benchmark methodology

- **pp512** — prompt processing throughput (tokens/sec, prefill)
- **tg128** — token generation throughput (tokens/sec, interactive)
- Each backend tested twice per model: `-fa 0` and `-fa 1`
- Winners per model/test are **margin-aware**; multiple winners are possible when mean±σ overlap
- Built from the same llama.cpp commit for consistency

**Backends in this dataset:** ROCm 7 RC + ROCWMMA + hipBLASLt, ROCm 7 RC (hipBLASLt), ROCm 7 RC (hipBLASLt OFF), ROCm 7 RC + ROCWMMA (hipBLASLt OFF), ROCm 6.4.4 (hipBLASLt), ROCm 6.4.4 (hipBLASLt OFF), ROCm 6.4.4 + ROCWMMA (hipBLASLt), ROCm 6.4.4 + ROCWMMA (hipBLASLt OFF), Vulkan AMDVLK, Vulkan RADV

**ROCm 7 hipBLASLt policy:** Toolboxes ship with **hipBLASLt enabled** by default (`ROCBLAS_USE_HIPBLASLT=1`). The benchmark script also runs **hipBLASLt OFF** variants (`-hblt0`) to measure its effect.

---

## Summary of current dataset (Flash Attention ON)

### Placement counts
**Prompt Processing (pp512)**
| Backend | 1st | 2nd | 3rd |
| --- | ---: | ---: | ---: |
| ROCm 6.4.4 (hipBLASLt) | 6 | 2 | 2 |
| Vulkan AMDVLK | 6 | 1 | 0 |
| ROCm 6.4.4 (hipBLASLt OFF) | 3 | 2 | 3 |
| Vulkan RADV | 1 | 2 | 0 |
| ROCm 7 RC (hipBLASLt) | 1 | 1 | 1 |
| ROCm 6.4.4 + ROCWMMA (hipBLASLt OFF) | 0 | 5 | 4 |
| ROCm 6.4.4 + ROCWMMA (hipBLASLt) | 0 | 4 | 2 |
| ROCm 7 RC (hipBLASLt OFF) | 0 | 0 | 2 |
| ROCm 7 RC + ROCWMMA + hipBLASLt | 0 | 0 | 3 |

**Token Generation (tg128)**
| Backend | 1st | 2nd | 3rd |
| --- | ---: | ---: | ---: |
| Vulkan RADV | 10 | 1 | 2 |
| Vulkan AMDVLK | 3 | 10 | 0 |
| ROCm 6.4.4 + ROCWMMA (hipBLASLt OFF) | 2 | 3 | 7 |
| ROCm 6.4.4 (hipBLASLt) | 1 | 4 | 3 |
| ROCm 6.4.4 (hipBLASLt OFF) | 1 | 3 | 5 |
| ROCm 6.4.4 + ROCWMMA (hipBLASLt) | 1 | 2 | 6 |
| ROCm 7 RC (hipBLASLt) | 1 | 0 | 1 |
| ROCm 7 RC (hipBLASLt OFF) | 0 | 1 | 1 |
| ROCm 7 RC + ROCWMMA + hipBLASLt | 0 | 1 | 1 |
| ROCm 7 RC + ROCWMMA (hipBLASLt OFF) | 0 | 1 | 1 |

### Pairwise head-to-head wins
For any model+quant where both backends succeeded, this counts who was faster (ties when equal).
| Comparison | Test | A wins | B wins | Ties | Total |
| --- | --- | ---: | ---: | ---: | ---: |
| ROCm 7 RC + ROCWMMA + hipBLASLt vs Vulkan AMDVLK | pp512 | 9 | 7 | 0 | 16 |
| ROCm 7 RC + ROCWMMA + hipBLASLt vs Vulkan AMDVLK | tg128 | 2 | 14 | 0 | 16 |
| ROCm 7 RC + ROCWMMA + hipBLASLt vs Vulkan RADV | pp512 | 14 | 3 | 0 | 17 |
| ROCm 7 RC + ROCWMMA + hipBLASLt vs Vulkan RADV | tg128 | 4 | 12 | 1 | 17 |
| Vulkan AMDVLK vs Vulkan RADV | pp512 | 12 | 4 | 0 | 16 |
| Vulkan AMDVLK vs Vulkan RADV | tg128 | 5 | 11 | 0 | 16 |

### Average ranks
**Prompt Processing (pp512)**
| Backend | Avg Rank (↓ is better) |
| --- | ---: |
| Vulkan AMDVLK | 1.14 |
| ROCm 6.4.4 (hipBLASLt) | 1.6 |
| Vulkan RADV | 1.67 |
| ROCm 6.4.4 (hipBLASLt OFF) | 2.0 |
| ROCm 7 RC (hipBLASLt) | 2.0 |
| ROCm 6.4.4 + ROCWMMA (hipBLASLt) | 2.33 |
| ROCm 6.4.4 + ROCWMMA (hipBLASLt OFF) | 2.44 |
| ROCm 7 RC (hipBLASLt OFF) | 3.0 |
| ROCm 7 RC + ROCWMMA + hipBLASLt | 3.0 |

**Token Generation (tg128)**
| Backend | Avg Rank (↓ is better) |
| --- | ---: |
| Vulkan RADV | 1.38 |
| Vulkan AMDVLK | 1.77 |
| ROCm 7 RC (hipBLASLt) | 2.0 |
| ROCm 6.4.4 (hipBLASLt) | 2.25 |
| ROCm 6.4.4 + ROCWMMA (hipBLASLt OFF) | 2.42 |
| ROCm 6.4.4 (hipBLASLt OFF) | 2.44 |
| ROCm 7 RC + ROCWMMA + hipBLASLt | 2.5 |
| ROCm 7 RC (hipBLASLt OFF) | 2.5 |
| ROCm 7 RC + ROCWMMA (hipBLASLt OFF) | 2.5 |
| ROCm 6.4.4 + ROCWMMA (hipBLASLt) | 2.56 |

---

## Analyses by feature

### Impact of Flash Attention
Median % change when **Flash Attention ON vs OFF**, paired by model+quant, per backend:
| Backend | pp512 Δ% (median, min..max, n) | tg128 Δ% (median, min..max, n) |
| --- | --- | --- |
| ROCm 7 RC + ROCWMMA + hipBLASLt | 11.4% (4.2..34.1), n=17 | -0.5% (-8.8..0.8), n=17 |
| ROCm 7 RC (hipBLASLt) | 11.7% (-23.0..25.6), n=14 | -1.1% (-8.7..1.0), n=14 |
| ROCm 7 RC (hipBLASLt OFF) | 6.8% (2.1..18.4), n=15 | -0.8% (-9.0..0.5), n=15 |
| ROCm 7 RC + ROCWMMA (hipBLASLt OFF) | 6.3% (-5.5..17.4), n=16 | -0.8% (-15.1..0.6), n=16 |
| ROCm 6.4.4 (hipBLASLt) | 8.3% (5.6..20.8), n=17 | 0.8% (-3.0..2.6), n=17 |
| ROCm 6.4.4 (hipBLASLt OFF) | 7.2% (-0.5..19.5), n=17 | 1.1% (-2.9..2.7), n=17 |
| ROCm 6.4.4 + ROCWMMA (hipBLASLt) | 7.1% (5.0..19.9), n=17 | 0.9% (-2.8..2.8), n=17 |
| ROCm 6.4.4 + ROCWMMA (hipBLASLt OFF) | 6.5% (2.7..18.6), n=17 | 1.1% (-2.7..3.4), n=17 |
| Vulkan AMDVLK | 1.3% (-10.8..27.8), n=16 | -1.2% (-6.8..0.1), n=16 |
| Vulkan RADV | 4.8% (-0.5..20.1), n=17 | -0.1% (-2.1..2.0), n=17 |

### Impact of ROCWMMA
| Context | Test | Compared Envs | Pairs | Median Δ% |
| --- | --- | --- | ---: | ---: |
| ROCm 7 RC (hipBLASLt) | pp512 | ROCm 7 RC + ROCWMMA + hipBLASLt vs ROCm 7 RC (hipBLASLt) | 15 | -0.0% |
| ROCm 7 RC (hipBLASLt) | tg128 | ROCm 7 RC + ROCWMMA + hipBLASLt vs ROCm 7 RC (hipBLASLt) | 15 | 0.0% |
| ROCm 7 RC (hipBLASLt OFF) | pp512 | ROCm 7 RC + ROCWMMA (hipBLASLt OFF) vs ROCm 7 RC (hipBLASLt OFF) | 17 | -0.2% |
| ROCm 7 RC (hipBLASLt OFF) | tg128 | ROCm 7 RC + ROCWMMA (hipBLASLt OFF) vs ROCm 7 RC (hipBLASLt OFF) | 17 | 0.0% |
| ROCm 6.4.4 (hipBLASLt) | pp512 | ROCm 6.4.4 + ROCWMMA (hipBLASLt) vs ROCm 6.4.4 (hipBLASLt) | 17 | -0.4% |
| ROCm 6.4.4 (hipBLASLt) | tg128 | ROCm 6.4.4 + ROCWMMA (hipBLASLt) vs ROCm 6.4.4 (hipBLASLt) | 17 | 0.0% |
| ROCm 6.4.4 (hipBLASLt OFF) | pp512 | ROCm 6.4.4 + ROCWMMA (hipBLASLt OFF) vs ROCm 6.4.4 (hipBLASLt OFF) | 17 | -0.5% |
| ROCm 6.4.4 (hipBLASLt OFF) | tg128 | ROCm 6.4.4 + ROCWMMA (hipBLASLt OFF) vs ROCm 6.4.4 (hipBLASLt OFF) | 17 | -0.1% |

### Impact of hipBLASLt
| Context | Test | Compared Envs | Pairs | Median Δ% |
| --- | --- | --- | ---: | ---: |
| ROCm 7 RC (no ROCWMMA) | pp512 | ROCm 7 RC (hipBLASLt) vs ROCm 7 RC (hipBLASLt OFF) | 15 | -0.2% |
| ROCm 7 RC (no ROCWMMA) | tg128 | ROCm 7 RC (hipBLASLt) vs ROCm 7 RC (hipBLASLt OFF) | 15 | 0.0% |
| ROCm 7 RC + ROCWMMA | pp512 | ROCm 7 RC + ROCWMMA + hipBLASLt vs ROCm 7 RC + ROCWMMA (hipBLASLt OFF) | 17 | -0.1% |
| ROCm 7 RC + ROCWMMA | tg128 | ROCm 7 RC + ROCWMMA + hipBLASLt vs ROCm 7 RC + ROCWMMA (hipBLASLt OFF) | 17 | 0.0% |
| ROCm 6.4.4 (no ROCWMMA) | pp512 | ROCm 6.4.4 (hipBLASLt) vs ROCm 6.4.4 (hipBLASLt OFF) | 17 | 0.0% |
| ROCm 6.4.4 (no ROCWMMA) | tg128 | ROCm 6.4.4 (hipBLASLt) vs ROCm 6.4.4 (hipBLASLt OFF) | 17 | 0.0% |
| ROCm 6.4.4 + ROCWMMA | pp512 | ROCm 6.4.4 + ROCWMMA (hipBLASLt) vs ROCm 6.4.4 + ROCWMMA (hipBLASLt OFF) | 17 | -0.3% |
| ROCm 6.4.4 + ROCWMMA | tg128 | ROCm 6.4.4 + ROCWMMA (hipBLASLt) vs ROCm 6.4.4 + ROCWMMA (hipBLASLt OFF) | 17 | 0.0% |

### Vulkan: AMDVLK vs RADV
Head-to-head wins with selected Flash Attention filter:
| Test | AMDVLK wins | RADV wins | Ties | Total |
| --- | ---: | ---: | ---: | ---: |
| pp512 | 12 | 4 | 0 | 16 |
| tg128 | 5 | 11 | 0 | 16 |

---

## Recommendations
- **Fastest prompt processing:** Vulkan AMDVLK, ROCm 6.4.4 (hipBLASLt) (most 1st-place finishes with selected Flash Attention filter).
- **Fastest token generation:** Vulkan RADV (most 1st-place finishes with selected Flash Attention filter).
- **Balanced choice:** Vulkan AMDVLK (consistently near the top across PP/TG).

---

## Winner calculation
A backend is counted as a winner if its mean throughput is within the best backend’s pooled ± error margin for that model/test type. This treats results within measurement noise as ties instead of false losses.