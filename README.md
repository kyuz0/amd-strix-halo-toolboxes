# amd-strix-halo-toolboxes

This repository provides Fedora Rawhide-based containers for working with Ryzen AI MAX+ 395 **Strix Halo** chips with integrated GPU (gfx1151) and unified memory. The containers come pre-built with `llama.cpp` and all necessary GPU compute libraries.

## TL;DR - Performance Summary

After extensive testing, **Vulkan is currently the most stable and performant option** for Strix Halo GPUs:

| Backend | Status | Notes |
|---------|---------|-------|
| **Vulkan** | ✅ **Recommended** | Most stable, best performance across all model sizes |
| **ROCm 6.4.2** | ⚠️ Limited | Works ok, but extremely slow past 64GB memory allocations |
| **ROCm 7.0 beta** | ❌ Unstable | Frequent crashes under heavy load (llama-bench), basic usage possible |

## Available Containers

| Container | Backend | Status | Use Case |
|-----------|---------|---------|----------|
| `vulkan` | Vulkan compute | Stable | **Primary recommendation** |
| `rocm-6.4.2` | ROCm 6.4.2 (HIP) | Stable for <64GB models | Smaller models only |
| `rocm-7beta` | ROCm 7.0 beta (HIP) | Beta/Unstable | Testing only |

All containers include up-to-date libraries from Fedora Rawhide, except ROCm 7.0 beta which uses [official AMD RPMs](https://repo.radeon.com/rocm/el9/7.0_beta/main).

## Prerequisites

- [Podman](https://podman.io/) (or Docker with alias)
- [Toolbox](https://containertoolbx.org/)
- Linux kernel with AMD GPU (`amdgpu`) drivers
- AMD Strix Halo GPU with proper host configuration (see below)

## Quick Start

### 1. Pull Pre-built Images

```bash
# Recommended: Vulkan (most stable)
podman pull docker.io/kyuz0/amd-strix-halo-toolboxes:vulkan

# Optional: ROCm variants for testing
podman pull docker.io/kyuz0/amd-strix-halo-toolboxes:rocm-6.4.2
podman pull docker.io/kyuz0/amd-strix-halo-toolboxes:rocm-7beta
```

### 2. Create Toolboxes

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

### 3. Enter and Test

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

## Performance Benchmarks

All benchmarks performed on HP Z2 Mini G1a with 128GB RAM, using `llama-bench` with all layers offloaded to GPU.

### Prompt Processing (pp512) - tokens/second

| Model | Size | Params | Vulkan | ROCm 6.4.2 | ROCm 7 Beta | Winner |
|-------|------|---------|---------|-------------|-------------|---------|
| **Gemma3 12B Q8_0** | 13.40 GiB | 11.77B | 509.45 ± 1.01 | 224.43 ± 0.26 | 219.55 ± 0.41 | 🏆 **Vulkan** (+132%) |
| **Qwen3 MoE 30B.A3B BF16** | 56.89 GiB | 30.53B | 74.62 ± 0.63 | 157.87 ± 2.71 | 155.37 ± 2.64 | 🏆 **ROCm 6.4.2** (+112%) |
| **Llama4 17Bx16E (Scout) Q4_K** | 57.73 GiB | 107.77B | 136.47 ± 1.52 | 132.61 ± 0.65 | ❌ GPU Hang | 🏆 **Vulkan** (+3%) |
| **Qwen3 MoE 235B.A22B Q3_K** | 96.99 GiB | 235.09B | 59.12 ± 0.39 | ⚠️ Too slow | ⚠️ Too slow | 🏆 **Vulkan only** |

### Text Generation (tg128) - tokens/second

| Model | Size | Params | Vulkan | ROCm 6.4.2 | ROCm 7 Beta | Winner |
|-------|------|---------|---------|-------------|-------------|---------|
| **Gemma3 12B Q8_0** | 13.40 GiB | 11.77B | 13.67 ± 0.01 | 13.80 ± 0.00 | 13.43 ± 0.00 | 🏆 **ROCm 6.4.2** (+1%) |
| **Qwen3 MoE 30B.A3B BF16** | 56.89 GiB | 30.53B | 7.36 ± 0.00 | 23.67 ± 0.02 | 22.21 ± 0.00 | 🏆 **ROCm 6.4.2** (+222%) |
| **Llama4 17Bx16E (Scout) Q4_K** | 57.73 GiB | 107.77B | 20.05 ± 0.00 | 17.61 ± 0.00 | ❌ GPU Hang | 🏆 **Vulkan** (+14%) |
| **Qwen3 MoE 235B.A22B Q3_K** | 96.99 GiB | 235.09B | 15.97 ± 0.02 | ⚠️ Too slow | ⚠️ Too slow | 🏆 **Vulkan only** |

### Performance Summary

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

## Building Containers Locally (Optional)

If you prefer to build the containers yourself:

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

## Host Configuration

This should work on any Strix Halo device. For a complete list of available hardware, see: [Strix Halo Hardware Database](https://strixhalo-homelab.d7.wtf/Hardware)

### My Test Configuration
| Component | Specification |
|-----------|---------------|
| **Test Machine** | HP Z2 Mini G1a |
| **CPU** | Ryzen AI MAX+ 395 "Strix Halo" |
| **System Memory** | 128 GB RAM |
| **GPU Memory** | 512 MB allocated in BIOS |
| **Host OS** | Fedora 42, kernel 6.15.6-200.fc42.x86_64 |

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

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| GPU not detected | Verify `/dev/dri` and `/dev/kfd` devices exist on host |
| Memory errors | Check that kernel parameters are properly applied |
| Permission denied | Ensure your user is in the `video` group |
| ROCm crashes | Try Vulkan backend instead |
| Slow loading (>64GB models) | Use Vulkan instead of ROCm for large models |

### Verify GPU Access

```bash
# Check devices
ls -la /dev/dri /dev/kfd

# Check ROCm (in ROCm containers)
rocm-smi

# Check Vulkan (in Vulkan container)
vulkaninfo --summary
```

