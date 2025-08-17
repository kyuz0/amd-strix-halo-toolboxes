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

**Backends in this dataset:** ROCm 7 RC + ROCWMMA + hipBLASLt, ROCm 7 RC (hipBLASLt), ROCm 7 RC (hipBLASLt OFF), ROCm 7 RC + ROCWMMA (hipBLASLt OFF), ROCm 6.4.3 (hipBLASLt), ROCm 6.4.3 (hipBLASLt OFF), ROCm 6.4.3 + ROCWMMA (hipBLASLt), ROCm 6.4.3 + ROCWMMA (hipBLASLt OFF), Vulkan AMDVLK, Vulkan RADV

**ROCm 7 hipBLASLt policy:** Toolboxes ship with **hipBLASLt enabled** by default (`ROCBLAS_USE_HIPBLASLT=1`). The benchmark script also runs **hipBLASLt OFF** variants (`-hblt0`) to measure its effect.

---

## Summary of current dataset (Flash Attention ON)

### Placement counts
**Prompt Processing (pp512)**
| Backend | 1st | 2nd | 3rd |
| --- | ---: | ---: | ---: |
| ROCm 6.4.3 + ROCWMMA (hipBLASLt) | 9 | 5 | 0 |
| ROCm 7 RC + ROCWMMA (hipBLASLt OFF) | 3 | 3 | 8 |
| Vulkan AMDVLK | 3 | 0 | 2 |
| ROCm 7 RC + ROCWMMA + hipBLASLt | 1 | 8 | 4 |
| ROCm 6.4.3 + ROCWMMA (hipBLASLt OFF) | 0 | 0 | 1 |
| Vulkan RADV | 0 | 0 | 1 |

**Token Generation (tg128)**
| Backend | 1st | 2nd | 3rd |
| --- | ---: | ---: | ---: |
| Vulkan RADV | 13 | 0 | 0 |
| ROCm 6.4.3 (hipBLASLt) | 3 | 0 | 1 |
| ROCm 6.4.3 + ROCWMMA (hipBLASLt) | 1 | 4 | 3 |
| ROCm 6.4.3 + ROCWMMA (hipBLASLt OFF) | 1 | 2 | 4 |
| ROCm 6.4.3 (hipBLASLt OFF) | 1 | 1 | 1 |
| ROCm 7 RC (hipBLASLt OFF) | 1 | 1 | 1 |
| ROCm 7 RC + ROCWMMA (hipBLASLt OFF) | 1 | 1 | 1 |
| ROCm 7 RC (hipBLASLt) | 1 | 0 | 4 |
| Vulkan AMDVLK | 0 | 10 | 0 |
| ROCm 7 RC + ROCWMMA + hipBLASLt | 0 | 1 | 2 |

### Pairwise head-to-head wins
For any model+quant where both backends succeeded, this counts who was faster (ties when equal).
| Comparison | Test | A wins | B wins | Ties | Total |
| --- | --- | ---: | ---: | ---: | ---: |
| ROCm 7 RC + ROCWMMA + hipBLASLt vs Vulkan AMDVLK | pp512 | 11 | 4 | 0 | 15 |
| ROCm 7 RC + ROCWMMA + hipBLASLt vs Vulkan AMDVLK | tg128 | 4 | 10 | 1 | 15 |
| ROCm 7 RC + ROCWMMA + hipBLASLt vs Vulkan RADV | pp512 | 14 | 2 | 0 | 16 |
| ROCm 7 RC + ROCWMMA + hipBLASLt vs Vulkan RADV | tg128 | 3 | 13 | 0 | 16 |
| Vulkan AMDVLK vs Vulkan RADV | pp512 | 13 | 2 | 0 | 15 |
| Vulkan AMDVLK vs Vulkan RADV | tg128 | 2 | 13 | 0 | 15 |

### Average ranks
**Prompt Processing (pp512)**
| Backend | Avg Rank (↓ is better) |
| --- | ---: |
| ROCm 6.4.3 + ROCWMMA (hipBLASLt) | 1.36 |
| Vulkan AMDVLK | 1.8 |
| ROCm 7 RC + ROCWMMA + hipBLASLt | 2.23 |
| ROCm 7 RC + ROCWMMA (hipBLASLt OFF) | 2.36 |
| ROCm 6.4.3 + ROCWMMA (hipBLASLt OFF) | 3.0 |
| Vulkan RADV | 3.0 |

**Token Generation (tg128)**
| Backend | Avg Rank (↓ is better) |
| --- | ---: |
| Vulkan RADV | 1.0 |
| ROCm 6.4.3 (hipBLASLt) | 1.5 |
| Vulkan AMDVLK | 2.0 |
| ROCm 7 RC + ROCWMMA (hipBLASLt OFF) | 2.0 |
| ROCm 7 RC (hipBLASLt OFF) | 2.0 |
| ROCm 6.4.3 (hipBLASLt OFF) | 2.0 |
| ROCm 6.4.3 + ROCWMMA (hipBLASLt) | 2.25 |
| ROCm 6.4.3 + ROCWMMA (hipBLASLt OFF) | 2.43 |
| ROCm 7 RC (hipBLASLt) | 2.6 |
| ROCm 7 RC + ROCWMMA + hipBLASLt | 2.67 |

---

## Analyses by feature

### Impact of Flash Attention
Median % change when **Flash Attention ON vs OFF**, paired by model+quant, per backend:
| Backend | pp512 Δ% (median, min..max, n) | tg128 Δ% (median, min..max, n) |
| --- | --- | --- |
| ROCm 7 RC + ROCWMMA + hipBLASLt | 8.4% (3.6..65.6), n=14 | -1.1% (-8.2..-0.3), n=14 |
| ROCm 7 RC (hipBLASLt) | -20.2% (-27.8..6.5), n=10 | -1.4% (-8.5..3.0), n=10 |
| ROCm 7 RC (hipBLASLt OFF) | -20.4% (-28.2..-16.1), n=9 | -1.9% (-8.6..0.1), n=9 |
| ROCm 7 RC + ROCWMMA (hipBLASLt OFF) | 5.8% (1.3..24.1), n=16 | -1.1% (-7.4..15.1), n=16 |
| ROCm 6.4.3 (hipBLASLt) | -19.5% (-25.7..-11.9), n=12 | -1.2% (-6.9..0.8), n=12 |
| ROCm 6.4.3 (hipBLASLt OFF) | -10.3% (-22.3..3.6), n=9 | -1.6% (-11.1..0.0), n=9 |
| ROCm 6.4.3 + ROCWMMA (hipBLASLt) | 10.9% (3.9..25.7), n=15 | -0.4% (-7.5..3.0), n=15 |
| ROCm 6.4.3 + ROCWMMA (hipBLASLt OFF) | 6.4% (1.8..12.3), n=10 | -0.6% (-6.5..2.3), n=10 |
| Vulkan AMDVLK | 1.1% (-45.4..20.2), n=15 | -1.5% (-28.6..0.1), n=15 |
| Vulkan RADV | 3.4% (-2.6..12.5), n=16 | 0.0% (-5.8..2.4), n=16 |

### Impact of ROCWMMA
| Context | Test | Compared Envs | Pairs | Median Δ% |
| --- | --- | --- | ---: | ---: |
| ROCm 7 RC (hipBLASLt) | pp512 | ROCm 7 RC + ROCWMMA + hipBLASLt vs ROCm 7 RC (hipBLASLt) | 16 | 16.3% |
| ROCm 7 RC (hipBLASLt) | tg128 | ROCm 7 RC + ROCWMMA + hipBLASLt vs ROCm 7 RC (hipBLASLt) | 16 | -0.7% |
| ROCm 7 RC (hipBLASLt OFF) | pp512 | ROCm 7 RC + ROCWMMA (hipBLASLt OFF) vs ROCm 7 RC (hipBLASLt OFF) | 15 | 14.6% |
| ROCm 7 RC (hipBLASLt OFF) | tg128 | ROCm 7 RC + ROCWMMA (hipBLASLt OFF) vs ROCm 7 RC (hipBLASLt OFF) | 15 | -0.7% |
| ROCm 6.4.3 (hipBLASLt) | pp512 | ROCm 6.4.3 + ROCWMMA (hipBLASLt) vs ROCm 6.4.3 (hipBLASLt) | 15 | 17.4% |
| ROCm 6.4.3 (hipBLASLt) | tg128 | ROCm 6.4.3 + ROCWMMA (hipBLASLt) vs ROCm 6.4.3 (hipBLASLt) | 15 | -0.3% |
| ROCm 6.4.3 (hipBLASLt OFF) | pp512 | ROCm 6.4.3 + ROCWMMA (hipBLASLt OFF) vs ROCm 6.4.3 (hipBLASLt OFF) | 9 | 10.2% |
| ROCm 6.4.3 (hipBLASLt OFF) | tg128 | ROCm 6.4.3 + ROCWMMA (hipBLASLt OFF) vs ROCm 6.4.3 (hipBLASLt OFF) | 9 | 0.3% |

### Impact of hipBLASLt
| Context | Test | Compared Envs | Pairs | Median Δ% |
| --- | --- | --- | ---: | ---: |
| ROCm 7 RC (no ROCWMMA) | pp512 | ROCm 7 RC (hipBLASLt) vs ROCm 7 RC (hipBLASLt OFF) | 15 | -0.2% |
| ROCm 7 RC (no ROCWMMA) | tg128 | ROCm 7 RC (hipBLASLt) vs ROCm 7 RC (hipBLASLt OFF) | 15 | -0.1% |
| ROCm 7 RC + ROCWMMA | pp512 | ROCm 7 RC + ROCWMMA + hipBLASLt vs ROCm 7 RC + ROCWMMA (hipBLASLt OFF) | 16 | 1.4% |
| ROCm 7 RC + ROCWMMA | tg128 | ROCm 7 RC + ROCWMMA + hipBLASLt vs ROCm 7 RC + ROCWMMA (hipBLASLt OFF) | 16 | 0.0% |
| ROCm 6.4.3 (no ROCWMMA) | pp512 | ROCm 6.4.3 (hipBLASLt) vs ROCm 6.4.3 (hipBLASLt OFF) | 9 | 155.5% |
| ROCm 6.4.3 (no ROCWMMA) | tg128 | ROCm 6.4.3 (hipBLASLt) vs ROCm 6.4.3 (hipBLASLt OFF) | 9 | 0.0% |
| ROCm 6.4.3 + ROCWMMA | pp512 | ROCm 6.4.3 + ROCWMMA (hipBLASLt) vs ROCm 6.4.3 + ROCWMMA (hipBLASLt OFF) | 13 | 116.9% |
| ROCm 6.4.3 + ROCWMMA | tg128 | ROCm 6.4.3 + ROCWMMA (hipBLASLt) vs ROCm 6.4.3 + ROCWMMA (hipBLASLt OFF) | 13 | -0.0% |

### Vulkan: AMDVLK vs RADV
Head-to-head wins with selected Flash Attention filter:
| Test | AMDVLK wins | RADV wins | Ties | Total |
| --- | ---: | ---: | ---: | ---: |
| pp512 | 13 | 2 | 0 | 15 |
| tg128 | 2 | 13 | 0 | 15 |

---

## Recommendations
- **Fastest prompt processing:** ROCm 6.4.3 + ROCWMMA (hipBLASLt) (most 1st-place finishes with selected Flash Attention filter).
- **Fastest token generation:** Vulkan RADV (most 1st-place finishes with selected Flash Attention filter).
- **Balanced choice:** ROCm 6.4.3 + ROCWMMA (hipBLASLt) (consistently near the top across PP/TG).

---

## Winner calculation
A backend is counted as a winner if its mean throughput is within the best backend’s pooled ± error margin for that model/test type. This treats results within measurement noise as ties instead of false losses.