# AI Agent Context: AMD Strix Halo Llama.cpp Toolboxes

**Primary Goal:** This project provides pre-built containers ("toolboxes") for running `llama.cpp` optimally on AMD Ryzen AI Max "Strix Halo" APUs. It simplifies environment setup for ROCm and Vulkan backends, allowing users to leverage up to 124 GiB of unified system memory for LLM inference.

## Core Technologies
*   **Containerization**: [Toolbx](https://containertoolbx.org/) (Fedora) or Distrobox (Ubuntu). Underneath, Docker/Podman is used to build base images.
*   **Inference Engine**: [Llama.cpp](https://github.com/ggerganov/llama.cpp)
*   **Hardware / Drivers**: AMD "Strix Halo" APUs (Gfx1151). Implementations depend on ROCm (v6.4.4, v7.x) and Vulkan (Mesa RADV, AMDVLK).

## Repository Structure Overview
*   `/toolboxes/`: Dockerfiles used to build the container images (e.g., `rocm-6.4.4`, `rocm-7.2.3`, `vulkan-radv`). These often use multi-stage builds to compile Llama.cpp and extract standalone binaries.
*   `/benchmark/`: Shell scripts and Python utilities (like `generate_results_json.py`) to systematically test Llama.cpp throughput, latency, and RPC performance.
*   `/docs/`: Markdown documents, along with HTML/CSS/JS (e.g., `index.html`, `assets/`) for the GitHub Pages website (`strix-halo-toolboxes.com`), plus interactive benchmark viewers and documentation on VRAM estimation.
*   `/scripts/`: Python utilities, including `run_distributed_llama.py` for distributed inference across nodes.
*   `.github/workflows/`: GitHub Actions that automatically rebuild containers whenever the upstream `llama.cpp` master branch updates or when triggered manually.

## Critical Technical Quirks (Important for Development)
*   **Flash Attention & no-mmap**: Running `llama-server` or `llama-cli` on Strix Halo *requires* `-fa 1` (flash attention) and `--no-mmap` to avoid memory fragmentation and crashes.
*   **Kernel memory params**: The optimal Strix Halo host configuration relies on custom boot parameters (`iommu=pt amdgpu.gttsize=126976 ttm.pages_limit=32505856`) to allocate unified RAM to the iGPU.
*   **ROCm 7+ Workaround**: Due to LLVM compiler regressions, ROCm 7 builds currently use a workaround flag (`-mllvm --amdgpu-unroll-threshold-local=600`) to restore Llama.cpp performance.
*   **Kernel Bugs**: Avoid kernels older than 6.18.4, and the specifically broken `linux-firmware-20251125`.

## General Instructions for Coding Agents
1.  **Container Builds**: When modifying `Dockerfile.*` files inside `/toolboxes`, ensure the build output remains lean and only necessary runtime dependencies and Llama.cpp binaries are carried over.
2.  **Documentation Synchronization**: If adding a new backend or feature, ensure `README.md` is updated simultaneously.
3.  **Scripts**: Benchmarking and utility scripts are expected to integrate with standard `toolbox` execution. Use `/dev/dri` and `/dev/kfd` mounts for device access.
