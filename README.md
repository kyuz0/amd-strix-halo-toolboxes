# AMD Strix Halo Llama.cpp Toolboxes

This project provides pre-built containers (“toolboxes”) for running LLMs on **AMD Ryzen AI Max “Strix Halo”** integrated GPUs. Toolbx is the standard developer container system in Fedora (and now works on Ubuntu, openSUSE, Arch, etc).

---

### 📦 Project Context

This repository is part of the **[Strix Halo AI Toolboxes](https://strix-halo-toolboxes.com)** project. Check out the website for an overview of all toolboxes, tutorials, and host configuration guides.

### ❤️ Support

This is a hobby project maintained in my spare time. If you find these toolboxes and tutorials useful, you can **[buy me a coffee](https://buymeacoffee.com/dcapitella)** to support the work! ☕

## 📺 Video Demo

[![Watch the YouTube Video](https://img.youtube.com/vi/wCBLMXgk3No/maxresdefault.jpg)](https://youtu.be/wCBLMXgk3No)

## Table of Contents

- [Stable Configuration](#stable-configuration)
- [ROCm 7 Performance Regression Workaround](#rocm-7-performance-regression-workaround)
- [Supported Toolboxes](#supported-toolboxes)
- [Quick Start](#quick-start)
- [Host Configuration](#host-configuration)
- [Performance Benchmarks](#performance-benchmarks)
- [Memory Planning and VRAM Estimator](#memory-planning-and-vram-estimator)
- [Building Locally](#building-locally)
- [Distributed Inference](#distributed-inference)
- [More Documentation](#more-documentation)
- [References](#references)


## Stable Configuration

- **OS**: Fedora 42/43
- **Linux Kernel**: 6.18.9-200.fc43.x86_64
- **Linux Firmware**: 20260110

This is currently the most stable setup. Kernels older than 6.18.4 have a bug that causes stability issues on gfx1151 and should be avoided. Also, **do NOT use `linux-firmware-20251125`.** It breaks ROCm support on Strix Halo (instability/crashes).

> ⚠️ **Important**: See [Host Configuration](#host-configuration) for critical kernel parameters.

## Supported Toolboxes

> [!WARNING]
> **Deprecation Notice for `-mtp` toolboxes**: MTP support was recently merged into the main branch of `llama.cpp`. It is now available with all updates in the standard toolboxes. Please do **not** use the deprecated `-mtp` toolboxes.

You can check the containers on DockerHub: [kyuz0/amd-strix-halo-toolboxes](https://hub.docker.com/r/kyuz0/amd-strix-halo-toolboxes/tags).

### Stable Toolboxes

These are stable, tested containers that are automatically rebuilt whenever the `llama.cpp` master branch is updated.

| Container Tag | Backend/Stack | Purpose / Notes |
| :--- | :--- | :--- |
| `vulkan-radv` | Vulkan (Mesa RADV) | Most stable and compatible. Recommended for most users and all models. |
| `rocm-10.0` | ROCm 10.0 (Fedora 44) | Latest stable ROCm Core SDK build, using AMD's supported gfx1151 package set. |

### Experimental / Custom Toolboxes

These use nightly or custom backend stacks. Their rebuild policy is noted below.

| Container Tag | Backend/Stack | Purpose / Notes |
| :--- | :--- | :--- |
| `rocm-7.14-performance` | ROCm 7.14 (Experimental) | Build from [`gaetan-puleo/llama-cpp-strix-halo`](https://github.com/gaetan-puleo/llama-cpp-strix-halo) on `master`, retaining the ROCm 7.14 `gfx1151` runtime and build configuration. Auto-built when the fork updates; can also be built manually with the `rocm-7.14-performance` workflow argument. |
| `rocm-7.14-pr26592` | ROCm 7.14 (Experimental) | Downloads and applies draft [llama.cpp PR #26592](https://github.com/ggml-org/llama.cpp/pull/26592) at build time to enable hipCUB paths for ARGSORT/TOP_K-related operations. Manual build only with the `rocm-7.14-pr26592` workflow argument. |
| `vulkan-radv-performance` | Vulkan (Mesa RADV, Fedora 44) | Experimental build tracking [`Nathanw1014/llama.cpp:strix-halo-vulkan`](https://github.com/Nathanw1014/llama.cpp/tree/strix-halo-vulkan), with Strix Halo-focused flash-attention, KV-cache, lightning-indexer, and matrix/MoE performance work. Manual build only. |
| `rocm-7.14-rocmfpx` | ROCm 7.14 (Custom) | HIP-only `charlie12345/ROCmFPX` build for `gfx1151` with ROCmI4/W4A4 and ROCmFP3/FP4/FP6/FP8 weight formats, MTP speculative decoding, and agent-aware presets. Auto-built on upstream changes. |
| `vulkan-rocmfpx` | Vulkan (Custom) | Vulkan-only `charlie12345/ROCmFPX` build with ROCmFPX weight formats. No ROCm dependency. Auto-built on upstream changes. |
| `rocm-7.2.4-rdma-fix` | ROCm 7.2.4 (Custom) | Test build from `kyuz0/llama.cpp:fix/rpc-rdma-inline-fallback`, which retries RDMA QP creation without inline data. Manual build only. |
| `rocm-7.2.4-turboquant` | ROCm 7.2.4 (Custom) | Custom TurboQuant build for AMD Strix Halo. Manual build only. |
| `therock-nightly` | TheRock Nightly | Tracks the latest TheRock multi-arch `gfx1151` nightly tarball using the [official release layout](https://github.com/ROCm/TheRock/blob/main/RELEASES.md). Auto-built on upstream changes. |

> Legacy images (`rocm-6.4.2`, `rocm-6.4.3`, `rocm-7.1.1`) are excluded from these lists.

### Temporary llama.cpp ROCm Inference Workaround

The `rocm-10.0`, `rocm-7.14-performance`, `rocm-7.14-pr26592`, and `therock-nightly` images currently apply a
temporary workaround for [llama.cpp issue #25992](https://github.com/ggml-org/llama.cpp/issues/25992),
based on [pull request #25863](https://github.com/ggml-org/llama.cpp/pull/25863).
It prevents llama.cpp from selecting ROCm host buffers for computation on
integrated GPUs, which addresses the reported inference failures while retaining
pinned host memory for transfers.

The workaround is isolated in
[`toolboxes/llama-cpp-25992-rocm-host-buffer.patch`](toolboxes/llama-cpp-25992-rocm-host-buffer.patch)
and the corresponding Dockerfile build steps. It is intended to be removed once
llama.cpp incorporates an equivalent upstream fix.

The images include RDMA support for llama.cpp RPC. On Linux hosts with a
RoCEv2-capable NIC, llama.cpp automatically negotiates the RDMA transport when
available and otherwise falls back to TCP.

On Toolbx hosts, `refresh-toolboxes.sh` detects `/dev/infiniband` and adds the
required device, `rdma` group, and unlimited memlock options automatically.
For manual Toolbx creation, append:

```sh
--device /dev/infiniband --group-add rdma --ulimit memlock=-1
```

## Quick Start

Create and enter your toolbox of choice. **(Ubuntu users: remember to use `distrobox` instead of `toolbox` in the commands below).** (check [Strix Halo Toolboxes](https://strix-halo-toolboxes.com/#config) for details).

**Option A: Vulkan (RADV/AMDVLK)** - best for compatibility
```sh
toolbox create llama-vulkan-radv \
  --image docker.io/kyuz0/amd-strix-halo-toolboxes:vulkan-radv \
  -- --device /dev/dri --group-add video --security-opt seccomp=unconfined

toolbox enter llama-vulkan-radv
```

**Option B: ROCm (Recommended for Performance)**
```sh
toolbox create llama-rocm-10.0 \
  --image docker.io/kyuz0/amd-strix-halo-toolboxes:rocm-10.0 \
  -- --device /dev/dri --device /dev/kfd --group-add video --group-add render --group-add sudo \
  --security-opt seccomp=unconfined

toolbox enter llama-rocm-10.0
```

### 2. Check GPU Access
Inside the toolbox:

```sh
llama-cli --list-devices
```

### 3. Download Model
Example: Qwen3 Coder 30B (BF16)
Consider: setting your Hugging Face HF_TOKEN for faster downloads
```bash
HF_XET_HIGH_PERFORMANCE=1 hf download unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF \
  BF16/Qwen3-Coder-30B-A3B-Instruct-BF16-00001-of-00002.gguf \
  --local-dir models/qwen3-coder-30B-A3B/

HF_XET_HIGH_PERFORMANCE=1 hf download unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF \
  BF16/Qwen3-Coder-30B-A3B-Instruct-BF16-00002-of-00002.gguf \
  --local-dir models/qwen3-coder-30B-A3B/
```

### 4. Run Inference
> ⚠️ **IMPORTANT**: Always use **flash attention** (`-fa 1`) and **no-mmap** (`--no-mmap`) on Strix Halo to avoid crashes/slowdowns.

**Server Mode (API):**
```sh
llama-server -m models/qwen3-coder-30B-A3B/BF16/Qwen3-Coder-30B-A3B-Instruct-BF16-00001-of-00002.gguf \
  -c 8192 -ngl 999 -fa 1 --no-mmap
```

**Router Mode:**
> Uses [`models.ini`](docs/models.ini.example) preset configuration for multi-model routing.
```sh
llama-server --models-preset models.ini --host 0.0.0.0 --port 8080 --models-max 1 --parallel 1
```

**CLI Mode:**
```sh
llama-cli --no-mmap -ngl 999 -fa 1 \
  -m models/qwen3-coder-30B-A3B/BF16/Qwen3-Coder-30B-A3B-Instruct-BF16-00001-of-00002.gguf \
  -p "Write a Strix Halo toolkit haiku."
```

### 5. Keep Updated
Refresh your authenticated toolboxes to the latest nightly/stable builds:
```bash
./refresh-toolboxes.sh all
```

## Host Configuration

This should work on any Strix Halo. For a complete list of available hardware, see: [Strix Halo Hardware Database](https://strixhalo-homelab.d7.wtf/Hardware)

### Test Configuration

| Component         | Specification                                               |
| :---------------- | :---------------------------------------------------------- |
| **Test Machine**  | Framework Desktop                                           |
| **CPU**           | Ryzen AI MAX+ 395 "Strix Halo"                              |
| **System Memory** | 128 GB RAM                                                  |
| **GPU Memory**    | 512 MB allocated in BIOS                                    |
| **Host OS**       | Fedora 43, Linux 6.18.5-200.fc43.x86_64            |

### Kernel Parameters (tested on Fedora 42)

Add these boot parameters to enable unified memory while reserving a minimum of 4 GiB for the OS (max 124 GiB for iGPU):

> [!WARNING]
> Based on [benchmarking by Lars Urban (@urbanswelt)](https://github.com/urbanswelt), there is definitive indication that setting `amd_iommu=off` performs better than the previously recommended `iommu=pt`. Key result: `amd_iommu=off` is 5-12% faster than either IOMMU-enabled mode. See [Issue #66](https://github.com/kyuz0/amd-strix-halo-toolboxes/issues/66#issuecomment-4460612951) for details.

`amd_iommu=off amdgpu.gttsize=126976 ttm.pages_limit=32505856`

| Parameter                   | Purpose                                                                                    |
|-----------------------------|--------------------------------------------------------------------------------------------|
| `amd_iommu=off`             | Disables the AMD IOMMU. This improves performance and stability over `iommu=pt`.           |
| `amdgpu.gttsize=126976`     | Caps GPU unified memory to 124 GiB; 126976 MiB ÷ 1024 = 124 GiB                            |
| `ttm.pages_limit=32505856`  | Caps pinned memory to 124 GiB; 32505856 × 4 KiB = 126976 MiB = 124 GiB                     |

Apply with:
```bash
sudo grub2-mkconfig -o /boot/grub2/grub.cfg
sudo reboot
```

### Ubuntu 24.04
See [TechnigmaAI's Guide](https://github.com/technigmaai/technigmaai-wiki/wiki/AMD-Ryzen-AI-Max--395:-GTT--Memory-Step%E2%80%90by%E2%80%90Step-Instructions-%28Ubuntu-24.04%29).

### GPU Workload Cooling and Power Profiles

Framework Desktop users can install the [GPU workload watcher](systemd/gpu-workload-watch/README.md) to select performance or power-saving TuneD profiles automatically and increase cooling only during active GPU inference.

## Performance Benchmarks

🌐 **Interactive Viewer**: [https://kyuz0.github.io/amd-strix-halo-toolboxes/](https://kyuz0.github.io/amd-strix-halo-toolboxes/)

🔬 **Toolbox Comparison**: [Compare depth curves across Vulkan RADV, ROCm, and experimental toolbox builds](https://kyuz0.github.io/amd-strix-halo-toolboxes/toolbox-performance.html)

See [docs/benchmarks.md](docs/benchmarks.md) for full logs.

## Memory Planning and VRAM Estimator

Strix Halo uses unified memory. To estimate VRAM requirements for models (including context overhead), use the included tool:

```bash
gguf-vram-estimator.py models/my-model.gguf --contexts 32768
```
See [docs/vram-estimator.md](docs/vram-estimator.md) for details.

## Building Locally

You can build the containers yourself to customize packages or llama.cpp versions.
Instructions: [docs/building.md](docs/building.md).



## Distributed Inference

Run models across a cluster of Strix Halo machines using `run_distributed_llama.py`.
1.  Setup SSH keys between nodes.
2.  Run `python3 run_distributed_llama.py` on the main node.
3.  Follow the TUI to launch the cluster.

## More Documentation

*   [docs/benchmarks.md](docs/benchmarks.md)
*   [docs/vram-estimator.md](docs/vram-estimator.md)
*   [docs/building.md](docs/building.md)
*   [docs/troubleshooting-firmware.md](docs/troubleshooting-firmware.md)

## References

*   [Strix Halo Home Lab (deseven)](https://strixhalo-homelab.d7.wtf/)
*   [Strix Halo Testing Builds (lhl)](https://github.com/lhl/strix-halo-testing/tree/main)
*   [AMD ROCm 7.14 installation guide](https://rocm.docs.amd.com/en/docs-7.14.0/install/rocm.html)
