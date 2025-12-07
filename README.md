# AMD Strix Halo Llama.cpp Toolboxes

This project provides pre-built containers (“toolboxes”) for running LLMs on **AMD Ryzen AI Max “Strix Halo”** integrated GPUs. Toolbx is the standard developer container system in Fedora (and now works on Ubuntu, openSUSE, Arch, etc).

## 🚨 Updates — 2025-11-18

- Released new toolboxes for ROCm 7 that track the nightly builds, these are now called `alpha`. 
- Updated and extended benchmakrs across all llama.cpp backend configurations, and included bennchmarks over RPC (two nodes) and long context (32k) -> [Interactive Benchmark Viewer](https://kyuz0.github.io/amd-strix-halo-toolboxes/)

## Watch the YouTube Video

[![Watch the YouTube Video](https://img.youtube.com/vi/wCBLMXgk3No/maxresdefault.jpg)](https://youtu.be/wCBLMXgk3No)  

## Table of Contents

- [Quick Answers (Read This First)](#quick-answers-read-this-first)
1. [Llama.cpp Compiled for Every Backend](#1-llamacpp-compiled-for-every-backend)  
    1.1 [Supported Container Images](#11-supported-container-images)
2. [Quickest Usage Example](#2-quickest-usage-example)  
    2.1 [Creating the toolboxes with GPU access](#21-creating-the-toolboxes-with-gpu-access)  
    2.2 [Running models inside the toolboxes](#22-running-models-inside-the-toolboxes)  
    2.3 [Downloading GGUF Models from HuggingFace](#23-downloading-gguf-models-from-huggingface)  
3. [Performance Benchmarks](#3-performance-benchmarks)  
4. [Memory Planning & VRAM Estimator](#4-memory-planning--vram-estimator)  
5. [Building Containers Locally](#5-building-containers-locally)  
6. [Host Configuration](#6-host-configuration)  
    6.1 [Test Configuration](#61-test-configuration)  
    6.2 [Kernel Parameters (tested on Fedora 42)](#62-kernel-parameters-tested-on-fedora-42)  
    6.3 [Ubuntu 24.04](#63-ubuntu-2404)
7. [More Documentation](#7-more-documentation)  
8. [References](#8-references)


## Quick Answers (Read This First)

### How do I get a toolbox up and running?

**Command — Create Vulkan (RADV) toolbox**

```sh
toolbox create llama-vulkan-radv \
  --image docker.io/kyuz0/amd-strix-halo-toolboxes:vulkan-radv \
  -- --device /dev/dri --group-add video --security-opt seccomp=unconfined
```

**Command — Create ROCm toolbox (6.4.4/7.1.1/7rc/7alpha)**

```sh
toolbox create llama-rocm-7.1.1-rocwmma \
  --image docker.io/kyuz0/amd-strix-halo-toolboxes:rocm-7.1.1-rocwmma \
  -- --device /dev/dri --device /dev/kfd \
  --group-add video --group-add render --group-add sudo --security-opt seccomp=unconfined
```

**Command — Enter the toolbox shell**

```sh
toolbox enter llama-vulkan-radv
```

**Command — List detected GPUs (inside the toolbox)**

```sh
llama-cli --list-devices
```

### How do I download weights for a model?

**Command — Download a GGUF shard from Hugging Face**

```bash
HF_HUB_ENABLE_HF_TRANSFER=1 huggingface-cli download unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF \
  BF16/Qwen3-Coder-30B-A3B-Instruct-BF16-00001-of-00002.gguf \
  --local-dir models/qwen3-coder-30B-A3B/
```

`HF_HUB_ENABLE_HF_TRANSFER=1` turns on the Rust-based accelerated downloader (`pip install hf-transfer`).

### How do I run llama-server (and llama-cli) with a model?

Flash attention and no-memory-map **must** be enabled or Strix Halo will crawl/crash.

**Command — Run llama-server with flash attention + no-mmap**

```sh
llama-server -m models/qwen3-coder-30B-A3B/BF16/Qwen3-Coder-30B-A3B-Instruct-BF16-00001-of-00002.gguf \
  -c 8192 -ngl 999 -fa 1 --no-mmap
```

**Command — Run llama-cli with the same essentials**

```sh
llama-cli --no-mmap -ngl 999 -fa 1 -m models/qwen3-coder-30B-A3B/BF16/Qwen3-Coder-30B-A3B-Instruct-BF16-00001-of-00002.gguf \
  -p "Write a Strix Halo toolkit haiku."
```

### How do I keep the toolboxes updated?

**Command — Refresh every toolbox**

```bash
./refresh-toolboxes.sh all
```

**Command — Refresh specific toolboxes**

```bash
./refresh-toolboxes.sh llama-vulkan-radv llama-rocm-7.1.1-rocwmma
```

## 1. Llama.cpp Compiled for Every Backend

This project uses [Llama.cpp](https://github.com/ggerganov/llama.cpp), a high-performance inference engine for running local LLMs (large language models) on CPUs and GPUs. Llama.cpp is open source, extremely fast, and is the only engine supporting all key backends for AMD Strix Halo: Vulkan (RADV, AMDVLK) and ROCm/HIP

* **Vulkan** is a cross-platform, low-level graphics and compute API. Llama.cpp can use Vulkan for GPU inference with either the open Mesa RADV driver or AMD's "official" open AMDVLK driver. This is the most stable and supported option for AMD CPUs at the moment.
* **ROCm** is AMD's open-source answer to CUDA: a GPU compute stack for machine learning and HPC. With ROCm, you can run Llama.cpp on AMD GPUs in a way similar to how CUDA works on NVIDIA - this is not the most stable/mature, but recently it's been getting better.

### 1.1 Supported Container Images

You can check the containers on DockerHub: https://hub.docker.com/r/kyuz0/amd-strix-halo-toolboxes/tags.  

| Container Tag                  | Backend/Stack                          | Purpose / Notes |
| ------------------------------ | -------------------------------------- | --------------- |
| `vulkan-amdvlk`                | Vulkan (AMDVLK)                        | Fastest backend—AMD open-source driver. ≤2 GiB single buffer allocation limit, some large models won't load. |
| `vulkan-radv`                  | Vulkan (Mesa RADV)                     | Most stable and compatible. Recommended for most users and all models. |
| `rocm-6.4.4`                   | ROCm 6.4.4 (HIP) + hipBLASLt*          | Latest stable build for ROCm 6.4.4, performs very well with most model architectures/quants. |
| `rocm-6.4.4-rocwmma`           | ROCm 6.4.4 + ROCWMMA + hipBLASLt*      | 6.4.4 with ROCWMMA enabled for better flash attention on RDNA3+/CDNA. |
| `rocm-7.1.1`                   | ROCm 7.1.1 GA (HIP) + hipBLASLt*         | Current GA release for ROCm 7.x; improved scheduler and hipBLASLt kernels. |
| `rocm-7.1.1-rocwmma`             | ROCm 7.1.1 GA + ROCWMMA + hipBLASLt*     | 7.1.1 with ROCWMMA for maximum flash-attention throughput. |
| `rocm-7rc`                     | ROCm 7.9 (HIP) + hipBLASLt*         | Used to be the release candidate for ROCm 7.9.0 (hence the `rc` tag in the name), now released. |
| `rocm-7rc-rocwmma`             | ROCm 7.9 + ROCWMMA + hipBLASLt*     | 7.9.0 build with ROCWMMA—useful for early flash-attention validation. |
| `rocm-7alpha`                  | ROCm 7 Nightly (“7rc-alpha”) + hipBLASLt* | Tracks ROCm 7 nightly (alpha) preview with bleeding-edge patches. |
| `rocm-7alpha-rocwmma`          | ROCm 7 Nightly + ROCWMMA + hipBLASLt* | Same nightly/alpha stack with ROCWMMA tuned for flash attention. |
| `rocm-7alpha-rocwmma-improved` | ROCm 7 Nightly + ROCWMMA (improved) + hipBLASLt* | Nightly/Alpha stack plus extra ROCWMMA fixes; fastest but most experimental option. |

\* All these toolboxes export `ROCBLAS_USE_HIPBLASLT=1` because it historically delivered better performance and stability, altough this might not be the case any more.

> These containers are **automatically** rebuilt whenever the Llama.cpp master branch is updated, ensuring you get the latest bug fixes and new model support. The easiest way to update to the newest versions is by running the `refresh-toolboxes.sh` [script below](#211-toolbox-refresh-script-automatic-updates).
>
> Legacy images `rocm-6.4.2` and `rocm-6.4.3` are still on Docker Hub for reproducibility but are intentionally excluded from the active list above. Prefer `rocm-6.4.4+` or any `rocm-7.x` tag unless you must bisect an old regression. (The `rocm-7beta` images share the same status.)

---

## 2. Quickest Usage Example

### 2.1 Creating the toolboxes with GPU access

To use Llama.cpp with hardware acceleration inside a toolbox container, you must expose the right GPU device nodes from your host. The exact flags depend on the backend.

#### Command — Create Vulkan (RADV/AMDVLK) toolbox

```sh
toolbox create llama-vulkan-radv \
  --image docker.io/kyuz0/amd-strix-halo-toolboxes:vulkan-radv \
  -- --device /dev/dri --group-add video --security-opt seccomp=unconfined
```

*Only `/dev/dri` is required for Vulkan. Make sure your user is in the `video` group.*

#### Command — Create ROCm toolbox (swap the tag for 6.4.4, 7.1, 7rc, 7alpha…)

```sh
toolbox create llama-rocm-7.1-rocwmma \
  --image docker.io/kyuz0/amd-strix-halo-toolboxes:rocm-7.1-rocwmma \
  -- --device /dev/dri --device /dev/kfd \
  --group-add video --group-add render --group-add sudo --security-opt seccomp=unconfined
```

*ROCm needs both `/dev/dri` and `/dev/kfd`, plus the `video`, `render`, and sometimes `sudo` groups for full compute access. Swap `rocm-7.1-rocwmma` for any other active ROCm tag (6.4.4, 7rc, 7alpha, etc.).*

> **Note:**
>
> * `--device /dev/dri` provides graphics/video device nodes.
> * `--device /dev/kfd` is required for ROCm compute.
> * Extra groups (`video`, `render`, `sudo`) may be required for full access to GPU nodes and compute features, especially with ROCm.
> * Use `--security-opt seccomp=unconfined` to avoid seccomp sandbox issues (needed for some GPU syscalls).

### 2.1.1 Ubuntu users

Ubuntu’s `toolbox` package still breaks GPU access, so follow gyhor’s [issue comment](https://github.com/kyuz0/amd-strix-halo-toolboxes/issues/16#issuecomment-3582028864) and use [Distrobox](https://github.com/89luca89/distrobox) instead:

```sh
distrobox create -n llama-rocm-7.1.1 \
  --image docker.io/kyuz0/amd-strix-halo-toolboxes:rocm-7.1.1-rocwmma \
  --additional-flags "--device /dev/kfd --device /dev/dri --group-add video --group-add render --security-opt seccomp=unconfined"
distrobox enter llama-rocm-7.1.1
llama-cli --list-devices
```

### 2.1.2 Toolbox Refresh Script (Automatic Updates)

To pull the latest container images and recreate toolboxes cleanly, use the provided script:

#### 📦 `refresh-toolboxes.sh`

```bash
./refresh-toolboxes.sh all
```

This will:

1. Delete existing toolboxes (if any)
2. Pull the latest images from DockerHub
3. Recreate each toolbox with correct GPU access flags

You can also refresh just one or more toolboxes:

```bash
./refresh-toolboxes.sh llama-vulkan-radv llama-rocm-7.1.1-rocwmma
```

### 2.2 Running models inside the toolboxes

#### Command — Enter the toolbox shell

```sh
toolbox enter llama-vulkan-radv
```

*This drops you into a shell inside the toolbox using your regular user account. The container shares your host home directory—anything in `$HOME` is accessible and writable inside the toolbox, so treat it like your host shell.*

#### Command — Confirm Llama.cpp sees your GPU

```sh
llama-cli --list-devices
```

Run this inside the toolbox to verify RADV/AMDVLK/ROCm devices are visible before loading a multi-gigabyte model.

> ⚠️ Always pass **flash attention** and **no-memory-map** flags when running on Strix Halo. `llama-server` and `llama-cli` both expect `-fa 1 --no-mmap`. Skipping either tanks performance or triggers kernel crashes because of the giant unified memory aperture.

#### Command — Run llama-cli with flash attention + no-mmap

```sh
llama-cli --no-mmap -ngl 999 -fa 1 \
  -m models/qwen3-coder-30B-A3B/BF16/Qwen3-Coder-30B-A3B-Instruct-BF16-00001-of-00002.gguf \
  -p "Write a Strix Halo toolkit haiku."
```

- `-ngl 999` forces every layer onto the GPU.  
- `-fa 1` turns on flash attention; omit it and throughput collapses.  
- `--no-mmap` keeps allocations in unified memory rather than trying to memory-map multi-gigabyte files.

#### Command — Run llama-server with flash attention + no-mmap

```sh
llama-server -m models/qwen3-coder-30B-A3B/BF16/Qwen3-Coder-30B-A3B-Instruct-BF16-00001-of-00002.gguf \
  -c 8192 -ngl 999 -fa 1 --no-mmap
```

Adjust `-c` for context length and never drop `-fa 1 --no-mmap`.

## 2.3 Downloading GGUF Models from HuggingFace

Most Llama.cpp-compatible models are on [HuggingFace](https://huggingface.co/models?format=gguf). Filter for **GGUF** format, and try to pick Unsloth quantizations—they work great and are actively updated: https://huggingface.co/unsloth.

Download using the Hugging Face CLI. For example, to get the first shard of Qwen3 Coder 30B BF16 (https://huggingface.co/unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF):

#### Command — Download a GGUF shard with `huggingface-cli`

```bash
HF_HUB_ENABLE_HF_TRANSFER=1 huggingface-cli download unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF \
  BF16/Qwen3-Coder-30B-A3B-Instruct-BF16-00001-of-00002.gguf \
  --local-dir models/qwen3-coder-30B-A3B/
```

`HF_HUB_ENABLE_HF_TRANSFER=1` uses a Rust-based package that enables faster download (install from [Pypi](https://pypi.org/project/hf-transfer/)).

## 3. Performance Benchmarks

🌐 Interactive exploration of the latest benchmark runs: [Interactie Benchmark Viewer](https://kyuz0.github.io/amd-strix-halo-toolboxes/)

## 4. Memory Planning & VRAM Estimator

Running large language models locally requires estimating **total VRAM required**—not just for the model weights, but also for the "context" (number of active tokens) and extra overhead.

Use `gguf-vram-estimator.py` to check exactly how much memory you need for a given `.gguf` model and target context length. Example output:

```
$ gguf-vram-estimator.py models/llama-4-scout-17b-16e/Q4_K_XL/Llama-4-Scout-17B-16E-Instruct-UD-Q4_K_XL-00001-of-00002.gguf --contexts 4096 32768 1048576

--- Model 'Llama-4-Scout-17B-16E-Instruct' ---
Max Context: 10,485,760 tokens
Model Size: 57.74 GiB
Incl. Overhead: 2.00 GiB

--- Memory Footprint Estimation ---
   Context Size |  Context Memory | Est. Total VRAM
---------------------------------------------------
         4,096 |       1.88 GiB  |      61.62 GiB
        32,768 |      15.06 GiB  |      74.80 GiB
     1,048,576 |      49.12 GiB  |     108.87 GiB
```

With Q4\_K quantization, **Llama-4-Scout 17B** can reach a 1M token context and still fit within a 128GB system, but... **it will be extremely slow to process such a long context**: see benchmarks (e.g. \~200 tokens/sec for prompt processing). Processing a 1M token context may take hours.

Contrast: Qwen3-235B Q3\_K (quantized, 97GiB model):

```
$ gguf-vram-estimator.py models/qwen3-235B-Q3_K-XL/UD-Q3_K_XL/Qwen3-235B-A22B-Instruct-2507-UD-Q3_K_XL-00001-of-00003.gguf --contexts 65536 131072 262144

--- Memory Footprint Estimation ---
   Context Size |  Context Memory | Est. Total VRAM
---------------------------------------------------
        65,536 |     11.75 GiB |     110.75 GiB
       131,072 |     23.50 GiB |     122.50 GiB
       262,144 |     47.00 GiB |     146.00 GiB
```

For Qwen3-235B, **128GB RAM allows you to run with context up to \~130k tokens.**

* The estimator lets you plan ahead and avoid out-of-memory errors when loading or using models.
* For more examples and a breakdown of VRAM components, see [docs/vram-estimator.md](docs/vram-estimator.md).

---

## 5. Building Containers Locally

Pre-built toolbox container images are published on Docker Hub for immediate use. If you wish to build the containers yourself (for example, to customize packages or rebuild with a different llama.cpp version), see:

Full instructions: [docs/building.md](docs/building.md).

---

## 6. Host Configuration

This should work on any Strix Halo. For a complete list of available hardware, see: [Strix Halo Hardware Database](https://strixhalo-homelab.d7.wtf/Hardware)

### 6.1 Test Configuration

|                   |                                               |
| ----------------- | --------------------------------------------- |
| **Test Machine**  | HP Z2 Mini G1a                                |
| **CPU**           | Ryzen AI MAX+ 395 "Strix Halo"                |
| **System Memory** | 128 GB RAM                                    |
| **GPU Memory**    | 512 MB allocated in BIOS                      |
| **Host OS**       | Fedora 42, kernel 6.15.6-200.fc42.x86\_86\_64 |

### 6.2 Kernel Parameters (tested on Fedora 42)

Add these boot parameters to enable unified memory while reserving a minimum of 4 GiB for the OS (max 124 GiB for iGPU):

amd_iommu=off amdgpu.gttsize=126976 ttm.pages_limit=32505856

| Parameter                   | Purpose                                                                                    |
|-----------------------------|--------------------------------------------------------------------------------------------|
| `amd_iommu=off`             | Disables IOMMU for lower latency                                                           |
| `amdgpu.gttsize=126976`     | Caps GPU unified memory to 124 GiB; 126976 MiB ÷ 1024 = 124 GiB                            |
| `ttm.pages_limit=32505856`  | Caps pinned memory to 124 GiB; 32505856 × 4 KiB = 126976 MiB = 124 GiB                     |

Source: https://www.reddit.com/r/LocalLLaMA/comments/1m9wcdc/comment/n5gf53d/?context=3&utm_source=share&utm_medium=web3x&utm_name=web3xcss&utm_term=1&utm_content=share_button


**Apply the changes:**

```
# Edit /etc/default/grub to add parameters to GRUB_CMDLINE_LINUX
sudo grub2-mkconfig -o /boot/grub2/grub.cfg
sudo reboot
```

### 6.3 Ubuntu 24.04

Follow this guide by TechnigmaAI for a working configuration on Ubuntu 24.04:

[https://github.com/technigmaai/technigmaai-wiki/wiki/AMD-Ryzen-AI-Max--395:-GTT--Memory-Step%E2%80%90by%E2%80%90Step-Instructions-(Ubuntu-24.04)](https://github.com/technigmaai/technigmaai-wiki/wiki/AMD-Ryzen-AI-Max--395:-GTT--Memory-Step%E2%80%90by%E2%80%90Step-Instructions-%28Ubuntu-24.04%29)

## 7. More Documentation

* [docs/benchmarks.md](docs/benchmarks.md): Full benchmark logs, model list, parsed results  
* [docs/vram-estimator.md](docs/vram-estimator.md): Memory planning, practical example runs  
* [docs/building.md](docs/building.md): Local build, toolbox customization, advanced use  

## 8. References

* The main reference for AMD Ryzen AI MAX home labs, by deseven (there's also a Discord server): [https://strixhalo-homelab.d7.wtf/](https://strixhalo-homelab.d7.wtf/)
* Most comprehesive repostiry of test builds for Strix Halo by lhl -> [https://github.com/lhl/strix-halo-testing/tree/main](https://github.com/lhl/strix-halo-testing/tree/main)
* Ubuntu 24.04 configuration
  [https://github.com/technigmaai/technigmaai-wiki/wiki/AMD-Ryzen-AI-Max--395:-GTT--Memory-Step%E2%80%90by%E2%80%90Step-Instructions-(Ubuntu-24.04)](https://github.com/technigmaai/technigmaai-wiki/wiki/AMD-Ryzen-AI-Max--395:-GTT--Memory-Step%E2%80%90by%E2%80%90Step-Instructions-%28Ubuntu-24.04%29)
