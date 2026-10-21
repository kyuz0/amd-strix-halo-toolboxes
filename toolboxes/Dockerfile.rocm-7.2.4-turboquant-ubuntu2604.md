# Dockerfile.rocm-7.2.4-turboquant-ubuntu2604

**Author:** [@alxfu](https://github.com/alxfu)
**Based on:** [`Dockerfile.rocm-7.2.4-turboquant`](./Dockerfile.rocm-7.2.4-turboquant) by [@kyuz0](https://github.com/kyuz0)

Patch diff against the original Dockerfile. All changes were verified on an AMD Ryzen AI Max+ PRO 395 (Strix Halo / gfx1151) with 128 GB RAM using Distrobox on Ubuntu 26.04.

## 1. Fedora package fixes

Removes strict `--exclude='*-doc*' --exclude='*-docs*'` that breaks `git` installations on recent Fedora, and updates deprecated ROCm package names.

| Original | Patched |
|----------|---------|
| `--exclude='*-doc*' --exclude='*-docs*'` | removed |
| `hip-runtime-amd` | `rocm-hip` |
| `hip-devel` | `rocm-hip-devel` |

## 2. Path normalization (`/opt/rocm` → `/usr`)

The Fedora 43 ROCm packages install to standard `/usr` paths. Hardcoded `/opt/rocm` references cause build failures.

| Original | Patched |
|----------|---------|
| `/opt/rocm` | `/usr` |
| `/opt/rocm/llvm/bin` | `/usr/bin` |
| `/opt/rocm/amdgcn/bitcode` | `/usr/lib64/amdgcn/bitcode` |

## 3. Environment variable normalization

Updated `ENV` and `PATH` to reflect `/usr` standard paths.

| Variable | Original | Patched |
|----------|----------|---------|
| `ROCM_PATH` | `/opt/rocm` | `/usr` |
| `HIP_PATH` | `/opt/rocm` | `/usr` |
| `HIP_CLANG_PATH` | `/opt/rocm/llvm/bin` | `/usr/bin` |
| `HIP_DEVICE_LIB_PATH` | `/opt/rocm/amdgcn/bitcode` | `/usr/lib64/amdgcn/bitcode` |
| `PATH` | `/opt/rocm/bin:/opt/rocm/llvm/bin:$PATH` | `/usr/bin:$PATH` |

## 4. Dynamic LLVM bitcode resolution

Rolling LLVM bitcode file locations vary across Fedora releases. The original hardcoded `cmake` path to `--rocm-device-lib-path` fails when the file moves.

**Before:**
```
cmake -S . -B build ... -DHIP_PLATFORM=amd
```

**After:**
```
BITCODE=$(dirname $(find /usr -name "ocml.bc" | head -n 1)) && cmake -S . -B build ... -DHIP_PLATFORM=amd -DCMAKE_HIP_FLAGS="--rocm-path=/usr --rocm-device-lib-path=${BITCODE}"
```

## 5. UI bug fix — nodejs/npm injection

`llama.cpp` GUI tools crash when HuggingFace assets are missing and nodejs/npm is not installed. Adds `dnf install -y nodejs npm` before `git clean -xdf`.

## 6. RPC cleanup

Strips the `COPY --from=builder /opt/llama.cpp/build/bin/ggml-rpc-* /usr/local/bin/` line from the runtime stage. `ggml-rpc` is not built by default and is unnecessary for single-APU local inference.
