
# Building Containers Locally

If you want to build or customize the toolbox containers yourself (rather than using the pre-built Docker Hub images), this guide explains the process. Local builds are useful if you want to:

* Use a patched or forked version of llama.cpp
* Add additional tools or libraries
* Change the Fedora base image (Rawhide vs. stable)
* Audit every installed dependency

---

## 1. Prerequisites

* **Podman** (recommended on Fedora) or **Docker** (also fine)

---

## 2. Build an Image

Each backend has its own Dockerfile in `toolboxes/`.

**Example: Build the Vulkan RADV toolbox image**

```sh
cd toolboxes
podman build --no-cache -t llama-vulkan-radv -f Dockerfile.vulkan-radv .
```

**Example: Build the ROCm 10.0 toolbox image**

```sh
cd toolboxes
podman build --no-cache -t llama-rocm-10.0 -f Dockerfile.rocm-10.0 .
```

> You can use `docker build` if you prefer Docker.

---

## 3. Customizing the Build

* **llama.cpp version**: Most Dockerfiles accept `--build-arg REPO=...` and `--build-arg BRANCH=...`. The HRX Dockerfile instead accepts `STAGING_BRANCH`; its llama.cpp revision comes from that branch's pinned submodule.
* **Extra dependencies**: Add them to the Dockerfile as needed.
* **Other customizations**: Install tools, patch scripts, or swap to a different base image.

### Experimental HRX toolbox

The `hrx-staging` image follows AMD's [ggml staging build](https://github.com/ROCm/ggml-staging-automation). That repository pins the HRX and llama.cpp submodules and the required TheRock artifact run. It builds both projects and bundles the HRX/Loom/ROCm runtime libraries with llama.cpp. This is a different build path from the ROCm HIP Dockerfiles; `GGML_HRX=ON` is enabled by AMD's build script.

```sh
cd toolboxes
podman build -t llama-hrx-staging -f Dockerfile.hrx-staging .
podman run --rm llama-hrx-staging llama-cli --version
```

To try it on a Strix Halo host, provide both GPU devices:

```sh
toolbox create llama-hrx-staging --image localhost/llama-hrx-staging \
  -- --device /dev/dri --device /dev/kfd --group-add video --group-add render \
  --security-opt seccomp=unconfined
toolbox enter llama-hrx-staging
llama-cli --list-devices
```

Look for an `HRX0` `gfx1151` device before testing a model. Start with the [Qwen3-30B-A3B-Instruct-2507 Q4_K_M model](https://github.com/ggml-org/llama.cpp/discussions/27219) used for the initial HRX work, with `-fa 1 --no-mmap` as in the main README. AMD's staging branch is experimental and may not support every model or operation yet. The build downloads a pinned TheRock SDK and compiles HRX, so allow substantial disk space and build time. The existing workflow can build this image on demand with `backends=hrx-staging`; it is not in the automatic `all` set.

### Retained-PM4 Strix Halo build (`rocm-10.1-strix-llama`)

This image builds two things: a custom ROCm runtime (ROCr + HIP from
[`pwilkin/rocm-systems:ilintar-experiments`](https://github.com/pwilkin/rocm-systems/tree/ilintar-experiments))
and the engine ([`halo-box/strix-llama.cpp:master`](https://github.com/halo-box/strix-llama.cpp)). It
is built on Ubuntu 26.04 and pulls the ROCm 10.1 Core SDK from AMD's `ubuntu2604` deb stream. The
custom libraries install to `/opt/strix/lib` and lead `LD_LIBRARY_PATH`, and the build fails if the
retained-PM4 patch has disappeared from the runtime branch. Leading with `LD_LIBRARY_PATH` only works
while the engine's own libraries carry `DT_RUNPATH`: ROCm's linker writes the rpath CMake hands it as the
older `DT_RPATH`, which `ld.so` searches before `LD_LIBRARY_PATH` and which would pin the SDK's HIP and
ROCr, so the image rewrites them with `patchelf` and then checks every installed binary against
`/opt/strix/lib`. Nothing is pinned, so `--no-cache` is the
refresh mechanism, and `/opt/strix/versions.txt` records the two revisions that went in. Allow 40-60
minutes and several GB of free disk.

```sh
cd toolboxes
podman build --no-cache -t llama-rocm-10.1-strix-llama -f Dockerfile.rocm-10.1-strix-llama .
```

`REPO`/`BRANCH` select the engine (the tracked fallback is
`--build-arg REPO=https://github.com/pwilkin/llama.cpp.git --build-arg BRANCH=strix-halo`) and
`ROCM_SYSTEMS_REPO`/`ROCM_SYSTEMS_BRANCH` the runtime. Tests are compiled so that
`test-backend-sched-ring` can gate the build, and `LLAMA_TESTS_INSTALL=OFF` keeps every test binary out
of the image. [`poll-strix-llama.yaml`](../.github/workflows/poll-strix-llama.yaml) watches
[`halo-box/strix-llama.cpp:master`](https://github.com/halo-box/strix-llama.cpp) and dispatches the build
whenever that branch moves; it is not in the `all` set, so it does not rebuild on upstream llama.cpp
commits. The workflow can also be run on demand with `backends=rocm-10.1-strix-llama`; it builds with
`--no-cache`, so every published tag recompiles the custom ROCm runtime from branch HEAD too.

```sh
toolbox create llama-rocm-10.1-strix-llama --image localhost/llama-rocm-10.1-strix-llama \
  -- --device /dev/dri --device /dev/kfd --security-opt seccomp=unconfined
```

No `--group-add` here: the image is Ubuntu 26.04-based and has no `render` group, and both Docker and
podman resolve `--group-add` names against the image's `/etc/group`, so the lookup fails outright
(`unable to find group render: no matching entries in group file`). The groups are not needed - the
container runs as root and `/dev/kfd` plus `/dev/dri/renderD128` are world `rw`, so the GPU is
reachable without any supplementary group.

The image carries no wrapper and no baked server flags. This is the configuration measured at 1207 t/s
prompt processing (`pp2048`, depth 0) and 43.9 t/s decode on Qwen3.8-Flash-Next with its shared MTP
head:

```sh
llama-server -m model.gguf --mmproj mmproj-BF16.gguf --mmproj-device ROCm0 -dev ROCm0 -ngl all \
  -fa on -fit off --load-mode none --lazy-mode on-direct -ctk f16 -ctv f16 \
  -c 262144 -b 16384 -ub 16384 --parallel 1 --jinja \
  --spec-type draft-mtp,ngram-mod --spec-draft-n-max 3 --spec-draft-model mtp.gguf \
  --spec-draft-device ROCm0 --spec-draft-ngl all
```

* `--load-mode none` replaces the usual `--no-mmap` advice on this stack, and `--lazy-mode on-direct`
  is what reads the 28.8 GB per-layer embedding table with `pread()` instead of holding it resident.
  The `model has unused tensor per_layer_token_embd.weight` line at load is expected with both set.
* Never set `GGML_CUDA_ENABLE_UNIFIED_MEMORY`. It routes every allocation through `hipMallocManaged`;
  this device reports `XNACK: 0, Direct host access: 0`, and output corrupts under retained PM4 -
  garbage tokens without speculation, `init: invalid token` with the MTP draft.
* Bisection switches, one at a time: `GGML_CUDA_DISABLE_GRAPHS=1` (no batched graphs, about 6% slower
  decode), `DEBUG_HIP_GRAPH_CLASSIC_PATH=1` (graphs on, classic topological dispatch), and
  `AMD_LOG_LEVEL=3`, which logs `[hipGraph][PM4] retained N dispatches in M dwords` per lowered batch -
  the direct proof that the fast path is live.
* Tuning candidates, one at a time against the launch line above — all read from the source, none
  re-measured on ROCm 10.1: `GGML_CUDA_GRAPH_OPT=1` runs an extra optimisation pass over the captured
  graph and is off by default (`ggml-cuda.cu:7623-7630`); `GGML_SCHED_UMA_RING=3|4` deepens the ring of
  graph input copies on UMA devices, 2 by default and capped by `GGML_SCHED_MAX_COPIES` = 4
  (`ggml-backend.cpp:2183-2188`, `ggml/CMakeLists.txt:188`); `GGML_GDN_TILE_CFG=1|2|3` picks the
  gated-delta-net prefill tile shape, default `0`, or `1` when `H == 48` (`gated_delta_net.cu:1142-1160`);
  `GGML_CUDA_CUBLAS_COMPUTE_TYPE=f16|f32|bf16|auto` forces the compute type of matmuls dispatched to
  rocBLAS (`ggml-cuda.cu:1734-1749`).
* Under rootless Docker, do not use host networking. It masks `/sys`, `/sys/class/kfd` disappears, and
  ROCr then reports `no ROCm-capable device is detected` even with `/dev/kfd` passed through. Publish
  ports instead.

---

## 4. Using the Custom Image with Toolbx

Create a new toolbox using your freshly built image:

```sh
toolbox create llama-vulkan-radv --image localhost/llama-vulkan-radv \
  -- --device /dev/dri --group-add video --security-opt seccomp=unconfined
```

Replace the backend/image name and device/group options as needed (see main README Section 2.1).

---

## 5. Troubleshooting

* **Build fails (ROCm images especially):** Try building with more memory or swap.
* **Toolbox can't access GPU:** Make sure you pass the correct device/group options.

---

## 6. References

* [Fedora Toolbox Documentation](https://docs.fedoraproject.org/en-US/fedora-silverblue/toolbox/)
* [Podman Build Reference](https://docs.podman.io/en/latest/markdown/podman-build.1.html)
* [Docker Build Reference](https://docs.docker.com/engine/reference/commandline/build/)
