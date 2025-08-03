# AMD Strix Halo Llama.cpp Toolboxes

This project provides pre-built containers (“toolboxes”) for running LLMs on **AMD Ryzen AI Max “Strix Halo”** integrated GPUs. Toolbx is the standard developer container system in Fedora (and now works on Ubuntu, openSUSE, Arch, etc).

## Why Toolbx?

* Reproducible: never pollute your host system
* Seamless: shares your home and GPU devices, works like a native shell
* Flexible: easy to switch between Vulkan (open/closed drivers) and ROCm

## Table of Contents

1. [Llama.cpp Compiled for Every Backend](#1-llamacpp-compiled-for-every-backend)  
    1.1 [Supported Container Images](#11-supported-container-images)
2. [Quickest Usage Example](#2-quickest-usage-example)  
    2.1 [Creating the toolboxes with GPU access](#21-creating-the-toolboxes-with-gpu-access)  
    2.2 [Running models inside the toolboxes](#22-running-models-inside-the-toolboxes)  
    2.3 [Downloading GGUF Models from HuggingFace](#23-downloading-gguf-models-from-huggingface)  
3. [Performance Benchmarks (Key Results)](#3-performance-benchmarks-key-results)  
4. [Memory Planning & VRAM Estimator](#4-memory-planning--vram-estimator)  
5. [Building Containers Locally](#5-building-containers-locally)  
6. [Host Configuration](#6-host-configuration)  
    6.1 [Test Configuration](#61-test-configuration)  
    6.2 [Kernel Parameters (tested on Fedora 42)](#62-kernel-parameters-tested-on-fedora-42)  
    6.3 [Ubuntu 24.04](#63-ubuntu-2404)
7. [More Documentation](#7-more-documentation)  
8. [References](#8-references)



## 1. Llama.cpp Compiled for Every Backend

This project uses [Llama.cpp](https://github.com/ggerganov/llama.cpp), a high-performance inference engine for running local LLMs (large language models) on CPUs and GPUs. Llama.cpp is open source, extremely fast, and is the only engine supporting all key backends for AMD Strix Halo: Vulkan (RADV, AMDVLK) and ROCm/HIP

* **Vulkan** is a cross-platform, low-level graphics and compute API. Llama.cpp can use Vulkan for GPU inference with either the open Mesa RADV driver or AMD's "official" open AMDVLK driver. This is the most stable and supported option for AMD CPUs at the moment.
* **ROCm** is AMD's open-source answer to CUDA: a GPU compute stack for machine learning and HPC. With ROCm, you can run Llama.cpp on AMD GPUs in a way similar to how CUDA works on NVIDIA - this is not the most stable/mature, but recently it's been getting better.

### 1.1 Supported Container Images

| Container Tag   | Backend/Stack       | Purpose / Notes                                                                       |
| --------------- | ------------------- | ------------------------------------------------------------------------------------- |
| `vulkan-amdvlk` | Vulkan (AMDVLK)     | Fastest backend—use if model loads. AMD Open Source driver. May fail on >40 GiB/BF16. |
| `vulkan-radv`   | Vulkan (Mesa RADV)  | Most stable/compatible. Recommended for most users and all models.                    |
| `rocm-6.4.2`    | ROCm 6.4.2 (HIP)    | Stable for smaller (<40 GiB) and BF16 models. Crashes on larger quantized models.     |
| `rocm-7beta`    | ROCm 7.0 Beta (HIP) | Latest ROCm beta. No real improvement for Llama.cpp. Similar model limits to 6.4.2.   |
| `rocm-7rc`      | ROCm 7.0 RC (HIP)   | Release candidate ROCm 7.0. Same behavior as above.                                   |

You can also check the containers on DockerHub: https://hub.docker.com/r/kyuz0/amd-strix-halo-toolboxes/tags.

> *Each container is based on Fedora Rawhide and is built for maximum compatibility and performance on Strix Halo.*

---

## 2. Quickest Usage Example

### 2.1 Creating the toolboxes with GPU access

To use Llama.cpp with hardware acceleration inside a toolbox container, you must expose the GPU devices from your host. The exact flags and devices depend on the backend:

* **For Vulkan (RADV/AMDVLK):** Only `/dev/dri` is required.
  *Add the user to the video group for access to GPU devices.*

  ```sh
  toolbox create llama-vulkan-radv \
    --image docker.io/kyuz0/amd-strix-halo-toolboxes:vulkan-radv \
    -- --device /dev/dri --group-add video --security-opt seccomp=unconfined
  ```

* **For ROCm:** You must expose both `/dev/dri` and `/dev/kfd`, and add the user to extra groups for compute access.

  ```sh
  toolbox create llama-rocm-6.4.2 \
    --image docker.io/kyuz0/amd-strix-halo-toolboxes:rocm-6.4.2 \
    -- --device /dev/dri --device /dev/kfd \
    --group-add video --group-add render --group-add sudo --security-opt seccomp=unconfined
  ```

*Swap in the image/tag for the backend you want to use.*

> **Note:**
>
> * `--device /dev/dri` provides graphics/video device nodes.
> * `--device /dev/kfd` is required for ROCm compute.
> * Extra groups (`video`, `render`, `sudo`) may be required for full access to GPU nodes and compute features, especially with ROCm.
> * Use `--security-opt seccomp=unconfined` to avoid seccomp sandbox issues (needed for some GPU syscalls).

### 2.2 Running models inside the toolboxes&#x20;

Before running any commands, you must first enter your toolbox container shell using:

```sh
toolbox enter llama-vulkan-radv
```

*This will drop you into a shell inside the toolbox, using your regular user account. The container shares your host home directory—so anything in your home is directly accessible (take care: your files are exposed and writable inside the toolbox!).*

Once inside, the following commands show how to run local LLMs:

* `llama-cli --list-devices`
  *Lists available GPU devices for Llama.cpp.*
* `llama-cli --no-mmap --ngl 999 -fa -m <model>`
  *Runs inference on the specified model, with all layers on GPU and flash attention enabled (replace \*\* with your model path).*

## 2.3 Downloading GGUF Models from HuggingFace

Most Llama.cpp-compatible models are on [HuggingFace](https://huggingface.co/models?format=gguf). Filter for **GGUF** format, and try to pick Unsloth quantizations—they work great and are actively updated: https://huggingface.co/unsloth.

Download using the Hugging Face CLI. For example, to get the first shard of Qwen3 Coder 30B BF16 (https://huggingface.co/unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF):

```bash
HF_HUB_ENABLE_HF_TRANSFER=1 huggingface-cli download unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF \
  BF16/Qwen3-Coder-30B-A3B-Instruct-BF16-00001-of-00002.gguf \
  --local-dir models/qwen3-coder-30B-A3B/
```

`HF_HUB_ENABLE_HF_TRANSFER=1` uses a Rust-based package that enables faster download (install from [Pypi](https://pypi.org/project/hf-transfer/)).

## 3. Performance Benchmarks (Key Results)

Below are some results from real runs on Strix Halo hardware of `llama-bench`. For full tables and model-by-model breakdowns (including both prompt processing and token generation speeds), see [docs/benchmarks.md](docs/benchmarks.md).

| Model                          | Vulkan (AMDVLK)  | Vulkan (RADV)    | ROCm 6.4.2       | ROCm 7.0 Beta    | ROCm 7.0 RC      | 🏆 Best PP    | 🏆 Best TG     |
| ------------------------------ | ---------------- | ---------------- | ---------------- | ---------------- | ---------------- | ------------- | -------------- |
| **Gemma3 12B Q8\_0**           | 686 pp / 13.9 tg | 509 pp / 13.7 tg | 223 pp / 13.8 tg | 223 pp / 13.8 tg | 223 pp / 13.8 tg | **AMDVLK**    | **AMDVLK**     |
| **Gemma3 27B BF16**            | ❌ Crash          | 135 pp / 4.0 tg  | 89 pp / 4.0 tg   | 82 pp / 4.0 tg   | 83 pp / 4.0 tg   | **RADV**      | **ROCm6.4.2**  |
| **Llama-4-Scout 17B Q8\_0**    | 241 pp / 12.3 tg | 146 pp / 12.3 tg | ❌ Crash          | ❌ Crash          | ❌ Crash          | **AMDVLK**    | **AMDVLK**     |
| **Llama-4-Scout 17B Q4\_K XL** | 209 pp / 20.1 tg | 133 pp / 20.0 tg | 133 pp / 17.3 tg | 134 pp / 17.3 tg | ❌ Crash          | **AMDVLK**    | **AMDVLK**     |
| **Qwen3 MoE 30B BF16**         | 90 pp / 8.0 tg   | 71 pp / 7.3 tg   | 158 pp / 22.9 tg | 151 pp / 23.8 tg | 155 pp / 23.1 tg | **ROCm6.4.2** | **ROCm7 Beta** |
| **Qwen3-235B Q3\_K XL**        | 99 pp / 15.7 tg  | 58 pp / 16.3 tg  | 69 pp / 13.5 tg  | ❌ Crash          | 75 pp / 13.6 tg  | **AMDVLK**    | **RADV**       |


* **pp = tokens/sec, prompt processing (pre-fill, max speed)**
* **tg = tokens/sec, generation (interactive, single token at a time)**
* 🏆 denotes the winner

**Takeaways:**

* **Vulkan AMDVLK** is the fastest, when it works. There's currently an issue with memory allocation that causes some models to fail loading ([GitHub Issue 15054](https://github.com/ggml-org/llama.cpp/issues/15054)). 
* **Vulkan RADV** is the most stable and compatible (recommended for most usage).
* **ROCm** is typically only superior on BF16 models, otherwise less stable and may crash or hang.

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

Add these boot parameters to enable unified memory and optimal performance:

```
amd_iommu=off amdgpu.gttsize=131072 ttm.pages_limit=335544321
```

| Parameter                   | Purpose                                          |
| --------------------------- | ------------------------------------------------ |
| `amd_iommu=off`             | Disables IOMMU for lower latency                 |
| `amdgpu.gttsize=131072`     | Enables unified GPU/system memory (up to 128 GB) |
| `ttm.pages_limit=335544321` | Allows large pinned memory allocations           |

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
