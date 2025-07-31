# amd-strix-halo-toolboxes

Fedora Rawhide-based containers for AMD Ryzen AI MAX+ 395 **Strix Halo** chips with integrated GPU (gfx1151) and unified memory. Pre-built with `llama.cpp` and GPU compute libraries.

## Table of Contents

- [1. Performance Summary](#1-performance-summary)
- [2. Available Containers](#2-available-containers)
- [3. Quick Start](#3-quick-start)
  - [3.1 Prerequisites](#31-prerequisites)
  - [3.2 Pull Pre-built Images](#32-pull-pre-built-images)
  - [3.3 Create Toolboxes](#33-create-toolboxes)
  - [3.4 Enter and Test](#34-enter-and-test)
- [4. Performance Benchmarks](#4-performance-benchmarks)
  - [4.1 Prompt Processing Results](#41-prompt-processing-pp512---tokenssecond)
  - [4.2 Text Generation Results](#42-text-generation-tg128---tokenssecond)
  - [4.3 Performance Analysis](#43-performance-analysis)
- [5. Memory Planning](#5-memory-planning)
  - [5.1 VRAM Estimation Tool](#51-the-gguf-vram-estimatorpy-utility)
  - [5.2 Usage Examples](#52-practical-examples-planning-for-a-128gb-strix-halo-system)
- [6. Building Locally](#6-building-containers-locally-optional)
- [7. Host Configuration](#7-host-configuration)

## 1. Performance Summary

**Vulkan is currently the most stable and performant option** for Strix Halo GPUs:

| Backend | Status | Notes |
|---------|---------|-------|
| **Vulkan** | ✅ **Recommended** | Most stable, best performance across all model sizes |
| **ROCm 6.4.2** | ⚠️ Limited | Works ok, but extremely slow past 64GB memory allocations |
| **ROCm 7.0 beta** | ❌ Unstable | Frequent crashes under heavy load (llama-bench), basic usage possible |

## 2. Available Containers

| Container | Backend | Status | Use Case |
|-----------|---------|---------|----------|
| `vulkan` | Vulkan compute | Stable | **Primary recommendation** |
| `rocm-6.4.2` | ROCm 6.4.2 (HIP) | Stable for <64GB models | Smaller models only |
| `rocm-7beta` | ROCm 7.0 beta (HIP) | Beta/Unstable | Testing only |

All containers include up-to-date libraries from Fedora Rawhide, except ROCm 7.0 beta which uses [official AMD RPMs](https://repo.radeon.com/rocm/el9/7.0_beta/main).

## 3. Quick Start

### 3.1 Prerequisites

- [Podman](https://podman.io/) (or Docker with alias)
- [Toolbox](https://containertoolbx.org/)
- Linux kernel with AMD GPU (`amdgpu`) drivers
- AMD Strix Halo GPU with proper host configuration (see [7. Host Configuration](#7-host-configuration))

### 3.2 Pull Pre-built Images

```bash
# Recommended: Vulkan (most stable)
podman pull docker.io/kyuz0/amd-strix-halo-toolboxes:vulkan

# Optional: ROCm variants for testing
podman pull docker.io/kyuz0/amd-strix-halo-toolboxes:rocm-6.4.2
podman pull docker.io/kyuz0/amd-strix-halo-toolboxes:rocm-7beta
```

### 3.3 Create Toolboxes

**For Vulkan (Recommended):**
```bash
toolbox create llama-vulkan \
  --image docker.io/kyuz0/amd-strix-halo-toolboxes:vulkan \
  -- \
    --device /dev/dri \
    --group-add video \
    --security-opt seccomp=unconfined
```

**For ROCm 6.4.2:**
```bash
toolbox create llama-rocm-6.4.2 \
  --image docker.io/kyuz0/amd-strix-halo-toolboxes:rocm-6.4.2 \
  -- \
    --device /dev/kfd \
    --device /dev/dri \
    --group-add video \
    --security-opt seccomp=unconfined
```

**For ROCm 7.0 beta:**
```bash
toolbox create llama-rocm-7beta \
  --image docker.io/kyuz0/amd-strix-halo-toolboxes:rocm-7beta \
  -- \
    --device /dev/kfd \
    --device /dev/dri \
    --group-add video \
    --security-opt seccomp=unconfined
```

> **Note:** The `--` separator passes the remaining flags to Podman/Docker for GPU access.

### 3.4 Enter and Test

**Test Vulkan container:**
```bash
toolbox enter llama-vulkan
vulkaninfo | head -n 10
llama-cli --list-devices
```

**Test ROCm containers:**
```bash
toolbox enter llama-rocm-6.4.2
llama-cli --list-devices
rocm-smi
```

## 4. Performance Benchmarks

All benchmarks performed on HP Z2 Mini G1a with 128GB RAM, using `llama-bench` with all layers offloaded to GPU.

### 4.1 Prompt Processing (pp512) - tokens/second

| Model | Size | Params | Vulkan | ROCm 6.4.2 | ROCm 7 Beta | Winner |
|-------|------|---------|---------|-------------|-------------|---------|
| **Gemma3 12B Q8_0** | 13.40 GiB | 11.77B | 509.45 ± 1.01 | 224.43 ± 0.26 | 219.55 ± 0.41 | 🏆 **Vulkan** (+132%) |
| **Qwen3 MoE 30B.A3B BF16** | 56.89 GiB | 30.53B | 74.62 ± 0.63 | 157.87 ± 2.71 | 155.37 ± 2.64 | 🏆 **ROCm 6.4.2** (+112%) |
| **Llama4 17Bx16E (Scout) Q4_K** | 57.73 GiB | 107.77B | 136.47 ± 1.52 | 132.61 ± 0.65 | ❌ GPU Hang | 🏆 **Vulkan** (+3%) |
| **Llama3.3 70B Q8_0** | 75.65 GiB | 70.55B | 76.51 ± 0.47 | ⚠️ Too slow | ⚠️ Too slow | 🏆 **Vulkan only** |
| **Llama4 17Bx16E (Scout) Q6_K** | 82.35 GiB | 107.77B | 139.05 ± 0.79 | ⚠️ Too slow | ⚠️ Too slow | 🏆 **Vulkan only** |
| **Qwen3 MoE 235B.A22B Q3_K** | 96.99 GiB | 235.09B | 59.12 ± 0.39 | ⚠️ Too slow | ⚠️ Too slow | 🏆 **Vulkan only** |
| **Llama4 17Bx16E (Scout) Q8_0** | 106.65 GiB | 107.77B | 148.17 ± 2.99 | ⚠️ Too slow | ⚠️ Too slow | 🏆 **Vulkan only** |

### 4.2 Text Generation (tg128) - tokens/second

| Model | Size | Params | Vulkan | ROCm 6.4.2 | ROCm 7 Beta | Winner |
|-------|------|---------|---------|-------------|-------------|---------|
| **Gemma3 12B Q8_0** | 13.40 GiB | 11.77B | 13.67 ± 0.01 | 13.80 ± 0.00 | 13.43 ± 0.00 | 🏆 **ROCm 6.4.2** (+1%) |
| **Qwen3 MoE 30B.A3B BF16** | 56.89 GiB | 30.53B | 7.36 ± 0.00 | 23.67 ± 0.02 | 22.21 ± 0.00 | 🏆 **ROCm 6.4.2** (+222%) |
| **Llama4 17Bx16E (Scout) Q4_K** | 57.73 GiB | 107.77B | 20.05 ± 0.00 | 17.61 ± 0.00 | ❌ GPU Hang | 🏆 **Vulkan** (+14%) |
| **Llama3.3 70B Q8_0** | 75.65 GiB | 70.55B | 2.72 ± 0.00 | ⚠️ Too slow | ⚠️ Too slow | 🏆 **Vulkan only** |
| **Llama4 17Bx16E (Scout) Q6_K** | 82.35 GiB | 107.77B | 15.22 ± 0.01 | ⚠️ Too slow | ⚠️ Too slow | 🏆 **Vulkan only** |
| **Qwen3 MoE 235B.A22B Q3_K** | 96.99 GiB | 235.09B | 15.97 ± 0.02 | ⚠️ Too slow | ⚠️ Too slow | 🏆 **Vulkan only** |
| **Llama4 17Bx16E (Scout) Q8_0** | 106.65 GiB | 107.77B | 12.22 ± 0.01 | ⚠️ Too slow | ⚠️ Too slow | 🏆 **Vulkan only** |

### 4.3 Performance Analysis

**🏆 Vulkan Advantages:**
- Consistently stable across all model sizes
- Significantly better prompt processing on smaller quantized models (127% faster on Gemma3 12B)
- Only option that can handle >64GB models efficiently
- Moderate advantage on larger quantized models (3-14% better on Llama4 17B)

**🏆 ROCm 6.4.2 Advantages:**
- **Dramatically superior performance on BF16 models** (112% faster prompt processing, 222% faster text generation on Qwen3 MoE 30B)
- Optimized native floating-point operations through HIP compute
- Better suited for models using native precision formats

**📊 Performance by Model Type:**
- **BF16/Native Precision Models**: ROCm 6.4.2 is the clear winner with 2-3x better performance
- **Small Quantized Models**: Vulkan has significant advantages for prompt processing
- **Large Quantized Models**: Performance is similar between backends (differences within noise)
- **Large Models (>64GB)**: Vulkan is the only viable option due to ROCm's memory allocation issues

**❌ ROCm 6.4.2 Limitations:**
- Extremely slow memory loading for models >64GB (unusable)
- Performance advantage limited to BF16/native precision models

**❌ ROCm 7.0 Beta Issues:**
- GPU hangs/crashes on larger models (Llama4 17B causes "GPU Hang" and core dump)
- Similar slow loading issues as ROCm 6.4.2 for models >64GB
- Performance similar to ROCm 6.4.2 when it works, but reliability is poor
- Uses [official AMD RPMs](https://repo.radeon.com/rocm/el9/7.0_beta/main) (beta quality)

**💡 Recommendation Strategy:**
- Use **ROCm 6.4.2** for BF16/native precision models under 64GB
- Use **Vulkan** for quantized models (especially smaller ones) and all models over 64GB
- For large quantized models under 64GB, either backend performs similarly
- Avoid ROCm 7.0 beta for production workloads

## 5. Memory Planning

VRAM usage has three components: **Model Weights + Context Memory (KV Cache) + Overhead**. The `gguf-vram-estimator.py` tool helps you choose the right model quantization and context size to fit within 128GB.

### 5.1 The `gguf-vram-estimator.py` Utility

Calculate total VRAM requirements for different context lengths:

```bash
# Basic usage
gguf-vram-estimator.py <path-to-gguf-file> [options]
```

**Key Options:**
- `--contexts`: Space-separated list of context sizes (e.g., `--contexts 4096 16384`)
- `--overhead`: Estimated overhead in GiB (default: `2.0`)

### 5.2 Practical Examples: Planning for a 128GB Strix Halo System

#### Scenario 1: High Quality, Short Context (Coding & Chat)

```bash
gguf-vram-estimator.py models/llama-4-scout-17b-16e/Q8_0/Llama-4-Scout-17B-16E-Instruct-Q8_0-00001-of-00003.gguf
```
```
--- Model 'Llama-4-Scout-17B-16E-Instruct' ---
Max Context: 10,485,760 tokens
Model Size: 106.67 GiB (from file size)
Incl. Overhead: 2.00 GiB (for compute buffer, etc. adjustable via --overhead)

--- Memory Footprint Estimation ---
   Context Size |  Context Memory | Est. Total VRAM
---------------------------------------------------
          4,096 |      768.00 MiB |      109.42 GiB
          8,192 |        1.50 GiB |      110.17 GiB
         16,384 |        1.88 GiB |      110.54 GiB
```
**Analysis:** The `Q8_0` model consumes **106.7 GiB**. A 16k context adds another **~1.9 GiB**, for a total of **~111 GiB**. This fits comfortably within a 128GB system.

#### Scenario 2: Massive Context, Lower Precision (RAG & Document Analysis)

```bash
gguf-vram-estimator.py models/llama-4-scout-17b-16e/Q4_K_XL/Llama-4-Scout-17B-16E-Instruct-UD-Q4_K_XL-00001-of-00002.gguf
```
```
--- Model 'Llama-4-Scout-17B-16E-Instruct' ---
Max Context: 10,485,760 tokens
Model Size: 57.74 GiB (from file size)
Incl. Overhead: 2.00 GiB (for compute buffer, etc. adjustable via --overhead)

--- Memory Footprint Estimation ---
   Context Size |  Context Memory | Est. Total VRAM
---------------------------------------------------
        524,288 |       25.12 GiB |       84.87 GiB
      1,048,576 |       49.12 GiB |      108.87 GiB
```
**Analysis:** To enable this, we use a `Q4_K_XL` model that is only **57.7 GiB**. The 1M token context adds a massive **49.1 GiB** of memory. The total, **~109 GiB**, is a tight but achievable fit on a 128GB system.

#### Scenario 3: Fitting a Very Large Model

```bash
gguf-vram-estimator.py models/qwen-3-235B-Q3_K-XL/UD-Q3_K_XL/Qwen3-235B-A22B-Instruct-2507-UD-Q3_K_XL-00001-of-00003.gguf
```
```
--- Model 'Qwen3-235B-A22B-Instruct-2507' ---
Max Context: 262,144 tokens
Model Size: 97.00 GiB (from file size)
Incl. Overhead: 2.00 GiB (for compute buffer, etc. adjustable via --overhead)

--- Memory Footprint Estimation ---
   Context Size |  Context Memory | Est. Total VRAM
---------------------------------------------------
         65,536 |       11.75 GiB |      110.75 GiB
        131,072 |       23.50 GiB |      122.50 GiB
        262,144 |       47.00 GiB |      146.00 GiB
```
**Analysis:** The base model takes **97 GiB**. You have approximately **30 GiB** of headroom. This allows for a very large context of **~131k tokens** before exceeding the system's 128GB capacity. Attempting the full 262k context would require `146 GiB` and fail.

## 6. Building Containers Locally (Optional)

```bash
# Build all variants
podman build -t localhost/llama-vulkan -f Dockerfile.vulkan .
podman build -t localhost/llama-rocm-6.4.2 -f Dockerfile.rocm-6.4.2 .
podman build -t localhost/llama-rocm-7beta -f Dockerfile.rocm-7beta .
```

### Create Toolboxes from Local Images

```bash
# Using locally built images
toolbox create llama-vulkan-local \
  --image localhost/llama-vulkan \
  -- \
    --device /dev/dri \
    --group-add video \
    --security-opt seccomp=unconfined

toolbox create llama-rocm-local \
  --image localhost/llama-rocm-6.4.2 \
  -- \
    --device /dev/kfd \
    --device /dev/dri \
    --group-add video \
    --security-opt seccomp=unconfined
```

## 7. Host Configuration

This should work on any Strix Halo device. For a complete list of available hardware, see: [Strix Halo Hardware Database](https://strixhalo-homelab.d7.wtf/Hardware)

### Test Configuration
| Component | Specification |
|-----------|---------------|
| **Test Machine** | HP Z2 Mini G1a |
| **CPU** | Ryzen AI MAX+ 395 "Strix Halo" |
| **System Memory** | 128 GB RAM |
| **GPU Memory** | 512 MB allocated in BIOS |
| **Host OS** | Fedora 42, kernel 6.15.6-200.fc42.x86_86_64 |

### Kernel Parameters

Add these boot parameters to enable unified memory and optimal performance:

```
amd_iommu=off amdgpu.gttsize=131072 ttm.pages_limit=335544321
```

| Parameter | Purpose |
|-----------|---------|
| `amd_iommu=off` | Disables IOMMU for lower latency |
| `amdgpu.gttsize=131072` | Enables unified GPU/system memory (up to 128 GB) |
| `ttm.pages_limit=335544321` | Allows large pinned memory allocations |

**Apply the changes:**
```bash
# Edit /etc/default/grub to add parameters to GRUB_CMDLINE_LINUX
sudo grub2-mkconfig -o /boot/grub2/grub.cfg
sudo reboot
```