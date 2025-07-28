# amd-strix-halo-toolboxes

This repository provides two Fedora Rawhide–based Dockerfiles for building isolated dev containers with AMD’s new **Strix Halo** GPUs (gfx1151):

- **Dockerfile.rocm**: Builds `llama.cpp` with ROCm (HIP) support targeting gfx1151
- **Dockerfile.vulkan**: Builds `llama.cpp` with Vulkan compute support

Both images load the latest ROCm/Vulkan libraries from Fedora Rawhide to ensure compatibility with Strix Halo.

## Repository Structure

```
.
├── Dockerfile.rocm        # HIP-based build for ROCm (gfx1151)
├── Dockerfile.vulkan      # Vulkan-based build
└── README.md              # This documentation
```

## Prerequisites

- **Podman** (or Docker aliased to Podman)
- **Toolbox** (for creating interactive dev containers, https://containertoolbx.org/)
- Recent Linux kernel with AMD GPU drivers (`amdgpu`) installed on the host

## 1. Pulling Pre-built Containers

If you don't want to build locally, pull pre-built images from the registry:

```bash
podman pull docker.io/kyuz0/amd-strix-halo-toolboxes:rocm
podman pull docker.io/kyuz0/amd-strix-halo-toolboxes:vulkan
```

```bash
toolbox create llama-rocm \
  --image docker.io/kyuz0/amd-strix-halo-toolboxes:rocm \
  -- \
    --device /dev/kfd \
    --device /dev/dri \
    --group-add video \
    --security-opt seccomp=unconfined
```

```bash
toolbox create llama-vulkan \
  --image docker.io/kyuz0/amd-strix-halo-toolboxes:vulkan \
  -- \
    --device /dev/dri \
    --group-add video \
    --security-opt seccomp=unconfined
```

## 2. Building the Images

### ROCm (HIP) Image

```bash
podman build -t llama-rocm -f Dockerfile.rocm .
```

### Vulkan Image

```bash
podman build -t llama-vulkan -f Dockerfile.vulkan .
```


- **Podman** (or Docker aliased to Podman)
- **Toolbox** (for creating interactive dev containers, https://containertoolbx.org/)
- Recent Linux kernel with AMD GPU drivers (`amdgpu`) installed on the host

## 1. Building the Images

### ROCm (HIP) Image

```bash
podman build -t llama-rocm -f Dockerfile.rocm .
```

### Vulkan Image

```bash
podman build -t llama-vulkan -f Dockerfile.vulkan .
```

## 2. Creating Toolbox Containers

Toolbox will automatically mount your home directory, map your UID:GID, enable X11, and use the host network. You only need to pass through the GPU devices and relax seccomp.

### ROCm Toolbox

```bash
toolbox create llama-rocm \
  --image docker.io/kyuz0/amd-strix-halo-toolboxes:rocm \
  -- \
    --device /dev/kfd \
    --device /dev/dri \
    --group-add video \
    --security-opt seccomp=unconfined
```

> **Note:** The `--` separator tells `toolbox` to pass subsequent flags to the underlying Podman/Docker command.

### Vulkan Toolbox

```bash
toolbox create llama-vulkan \
  --image docker.io/kyuz0/amd-strix-halo-toolboxes:vulkan \
  -- \
    --device /dev/dri \
    --group-add video \
    --security-opt seccomp=unconfined
```

## 3. Entering and Testing

After creation, enter each container and verify that your GPU and libraries are accessible.

### ROCm (HIP) Test

```bash
toolbox enter llama-rocm
# inside container:
llama-cli --list-devices
```

You should see your Strix Halo gfx1151 device listed.

### Vulkan Test

```bash
toolbox enter llama-vulkan
# inside container:
vulkaninfo | head -n 10
llama-cli --help  # run the Vulkan-enabled CLI
```

If `vulkaninfo` reports your GPU and `llama-cli` runs without errors, the Vulkan build is working.

## Host Configuration

The following host details and kernel settings ensure optimal performance and unified memory access for Strix Halo:

- **Machine**: HP Z2 Mini G1a  
- **Memory**: 128 GB RAM, with 512 MB allocated to the GPU in BIOS  
- **Host OS**: Fedora 42, kernel 6.15.6-200.fc42.x86_64  
- **Kernel boot parameters** (in `/etc/default/grub`):  
  ```text
  amd_iommu=off amdgpu.gttsize=131072 ttm.pages_limit=335544321
  ```  
  - `amd_iommu=off` disables IOMMU for lower latency and avoids address translation overhead.  
  - `amdgpu.gttsize=131072` sets the GPU GTT (Graphics Translation Table) size, enabling a unified memory window so the GPU can directly access up to 128 GB of system RAM.  
  - `ttm.pages_limit=335544321` raises the TTM (Translation Table Maps) page limit to allow larger pinned allocations.  
- **Apply parameters**: after editing `/etc/default/grub`, run  
  ```bash
  sudo grub2-mkconfig -o /boot/grub2/grub.cfg
  ```  

## Notes

Both images pull Fedora Rawhide packages for the newest ROCm/Vulkan support.
