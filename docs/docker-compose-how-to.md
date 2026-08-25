# Running with Docker Compose

The published images can be used directly with Docker Compose. Building a
local image is only necessary when you are developing a custom llama.cpp build.

For Strix Halo, use the stable `rocm-7.14` image as the primary backend and
keep `vulkan-radv` as a compatibility fallback. The two servers may be running
at the same time, but **load a model in only one backend at a time**: they
share the same unified memory pool.

## Prerequisites

* A Strix Halo host with a current kernel and firmware. See the [host
  configuration](../README.md#host-configuration) section.
* Docker Engine with Compose v2.
* A directory containing GGUF models. This guide uses `/home/ai-models`.

The ROCm image requires both `/dev/dri` and `/dev/kfd`; Vulkan requires only
`/dev/dri`. Do not use `privileged: true`. Grant just the GPU devices and the
render/video groups instead.

Find the host group IDs before creating the compose file:

```sh
getent group render
getent group video
```

The examples below use `991` and `44`, which are common values on Ubuntu. Use
the values reported by your own host.

`/dev/infiniband`, the `rdma` group, and an unlimited `memlock` ulimit are
only needed for multi-node llama.cpp RPC over RDMA/RoCE. They are not needed
for a single-machine server.

## ROCm 7.14

Create `compose.rocm.yaml`:

```yaml
services:
  llama-rocm:
    image: docker.io/kyuz0/amd-strix-halo-toolboxes:rocm-7.14
    container_name: llama-rocm
    restart: unless-stopped
    ports:
      - "127.0.0.1:8081:8080"
    devices:
      - /dev/dri
      - /dev/kfd
    group_add: ["991", "44"] # replace with the host render and video GIDs
    security_opt:
      - seccomp=unconfined
    volumes:
      - /home/ai-models:/models:ro
    command:
      - llama-server
      - --host
      - "0.0.0.0"
      - --port
      - "8080"
      - --model
      - /models/my-model.gguf
      - --ctx-size
      - "32768"
      - -ngl
      - "999"
      - -fa
      - "1"
      - --no-mmap
```

Start it with:

```sh
docker compose -f compose.rocm.yaml up -d
```

## Vulkan RADV

Create `compose.vulkan.yaml`:

```yaml
services:
  llama-vulkan:
    image: docker.io/kyuz0/amd-strix-halo-toolboxes:vulkan-radv
    container_name: llama-vulkan
    restart: unless-stopped
    ports:
      - "127.0.0.1:8080:8080"
    devices:
      - /dev/dri
    group_add: ["991", "44"] # replace with the host render and video GIDs
    security_opt:
      - seccomp=unconfined
    volumes:
      - /home/ai-models:/models:ro
    command:
      - llama-server
      - --host
      - "0.0.0.0"
      - --port
      - "8080"
      - --model
      - /models/my-model.gguf
      - --ctx-size
      - "32768"
      - -ngl
      - "999"
      - -fa
      - "1"
      - --no-mmap
```

Start it with:

```sh
docker compose -f compose.vulkan.yaml up -d
```

## Verify GPU access

```sh
docker exec llama-rocm llama-server --list-devices
docker exec llama-vulkan llama-server --list-devices
```

Both commands should list the Strix Halo GPU. For server inference, always use
Flash Attention (`-fa 1`) and disable mmap (`--no-mmap`), as shown above.

## Updating images

Toolbx users can use `refresh-toolboxes.sh`. Docker Compose users should pull
the updated image and recreate only the applicable service:

```sh
docker compose -f compose.rocm.yaml pull
docker compose -f compose.rocm.yaml up -d
```

The images track current llama.cpp builds. Test an updated backend with a
small model before relying on it for production workloads.
