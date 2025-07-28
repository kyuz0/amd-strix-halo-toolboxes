# amd-strix-halo-toolboxes

This repository provides Fedora Rawhide–based containers for dev work on AMD **Strix Halo** GPUs (gfx1151):

- **Dockerfile.rocm** — builds `llama.cpp` with ROCm (HIP) support
- **Dockerfile.vulkan** — builds `llama.cpp` with Vulkan compute support

Both containers have up-to-date ROCm/Vulkan libs from Fedora Rawhide.

## Prerequisites

- Podman (or Docker, aliased)
- Toolbox (https://containertoolbx.org/)
- Linux kernel with AMD GPU (`amdgpu`) drivers

## Pull and Run Pre-built Containers

**Pull pre-built images:**

```bash
podman pull docker.io/kyuz0/amd-strix-halo-toolboxes:rocm
podman pull docker.io/kyuz0/amd-strix-halo-toolboxes:vulkan
```

**Create toolboxes:**

```bash
toolbox create llama-rocm \
  --image docker.io/kyuz0/amd-strix-halo-toolboxes:rocm \
  -- \
    --device /dev/kfd \
    --device /dev/dri \
    --group-add video \
    --security-opt seccomp=unconfined

toolbox create llama-vulkan \
  --image docker.io/kyuz0/amd-strix-halo-toolboxes:vulkan \
  -- \
    --device /dev/dri \
    --group-add video \
    --security-opt seccomp=unconfined
```

> The `--` passes remaining flags to Podman/Docker for GPU access.

**Enter and test:**

```bash
toolbox enter llama-rocm
llama-cli --list-devices

toolbox enter llama-vulkan
vulkaninfo | head -n 10
llama-cli --help
```

## (Optional) Building the Images

```bash
podman build -t llama-rocm -f Dockerfile.rocm .
podman build -t llama-vulkan -f Dockerfile.vulkan .
```

## Host Configuration

- **Machine:** HP Z2 Mini G1a
- **Memory:** 128 GB RAM (512 MB GPU in BIOS)
- **Host OS:** Fedora 42, kernel 6.15.6-200.fc42.x86_64
- **Kernel boot parameters:**
  ```
  amd_iommu=off amdgpu.gttsize=131072 ttm.pages_limit=335544321
  ```
  - `amd_iommu=off` disables IOMMU for lower latency.
  - `amdgpu.gttsize=131072` enables unified GPU/system memory (up to 128 GB).
  - `ttm.pages_limit=335544321` allows large pinned allocations.
- **Apply with:**
  ```bash
  sudo grub2-mkconfig -o /boot/grub2/grub.cfg
  ```

Both containers use Fedora Rawhide packages for up-to-date ROCm and Vulkan support.
