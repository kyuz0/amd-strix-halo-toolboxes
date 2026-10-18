# TRELLIS.2 Toolbox for AMD Strix Halo (gfx1151)

Run [Microsoft TRELLIS.2](https://github.com/microsoft/TRELLIS) image-to-3D generation on AMD Ryzen AI Max "Strix Halo" integrated GPUs via ROCm.

## What is TRELLIS.2?

TRELLIS.2 is Microsoft's state-of-the-art image-to-3D generation model. Given a single image, it produces a textured 3D mesh (GLB/OBJ/STL). The pipeline involves sparse 3D convolutions, attention-based generation, and mesh extraction -- all of which require GPU acceleration.

## What was ported

TRELLIS.2 depends on several CUDA-only libraries. This toolbox ports or stubs each one for ROCm/HIP on gfx1151:

| Component | Status | Details |
|-----------|--------|---------|
| **CuMesh** | Fully ported | HIP port via `patch_cumesh_hip.sh` -- rocprim::tuple for radix sort decomposers, `__host__ __device__` Vec3f constructors, `--extended-lambda` removal, `-Wno-c++11-narrowing` |
| **FlexGEMM** | Works natively | Triton-based sparse convolutions, confirmed working on gfx1151 |
| **O-Voxel** | Compiled with fix | HIP kernels from [Lamothe/TRELLIS.2_rocm](https://github.com/Lamothe/TRELLIS.2_rocm) fork, `-Wno-c++11-narrowing` added for clang |
| **nvdiffrast** | Stubbed | CUDA-specific OpenGL interop has no ROCm equivalent. Mesh export works; real-time preview rendering is not available |
| **pipeline.json** | Patched | Uses ungated model mirrors to avoid authentication issues |
| **BiRefNet** | MIT replacement | Replaces gated RMBG-2.0 with MIT-licensed BiRefNet for background removal |

## Quick Start

### Build

```sh
cd toolboxes/trellis2
podman build --no-cache -t trellis2-gfx1151 -f Dockerfile.trellis2 .
```

### Run

```sh
podman run --rm -it --device /dev/dri --device /dev/kfd \
  --group-add video --group-add render \
  --security-opt seccomp=unconfined \
  -p 8080:8080 trellis2-gfx1151
```

### Generate a 3D model

```sh
curl -X POST http://localhost:8080/generate \
  -F "image=@photo.png" \
  -F "output_format=glb" \
  -o output.glb
```

### Health check

```sh
curl http://localhost:8080/health
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Service status, model info, GPU details |
| `/generate` | POST | Image-to-3D generation (multipart form: `image`, `seed`, `steps`, `cfg_strength`, `output_format`) |

## CuMesh HIP Port Details

The `patch_cumesh_hip.sh` script applies four targeted patches to CuMesh sources before PyTorch's hipify pass runs:

1. **rocprim::tuple** -- `cuda::std::tuple` is not available in ROCm. The radix sort decomposer in `clean_up.cu` uses it for 3-key decomposition. Replaced with `rocprim::tuple` and added explicit tuple construction for the return statement.

2. **`__host__ __device__` constructors** -- `Vec3f` constructors in `dtypes.cuh` were marked `__device__`-only, but are called from host code during mesh processing. Added `__host__` qualifier.

3. **`--extended-lambda` removal** -- This is an NVCC-specific flag. The HIP compiler (clang-based) does not recognize it and fails.

4. **`-Wno-c++11-narrowing`** -- Clang is stricter about narrowing conversions than NVCC. This suppresses warnings that would otherwise be treated as errors.

## Known Limitations

- **No real-time rendering preview**: nvdiffrast requires CUDA-specific OpenGL interop. Mesh export (GLB/OBJ/STL) works fully; only the interactive renderer is unavailable.
- **Memory usage**: The 4B model requires approximately 16-20 GB of unified memory during generation.
- **Base image**: Uses `kyuz0/vllm-therock-gfx1151` which provides PyTorch with ROCm support for gfx1151.

## Files

```
toolboxes/trellis2/
  Dockerfile.trellis2       # Container build
  patch_cumesh_hip.sh       # CuMesh HIP porting patches
  server.py                 # FastAPI wrapper
  nvdiffrast_stub/          # Stub package for nvdiffrast
    pyproject.toml
    nvdiffrast/
      __init__.py
      torch.py
  README.md                 # This file
```

## References

- [Microsoft TRELLIS](https://github.com/microsoft/TRELLIS)
- [Lamothe/TRELLIS.2_rocm](https://github.com/Lamothe/TRELLIS.2_rocm) -- ROCm fork with O-Voxel HIP kernels
- [JeffreyXiang/CuMesh](https://github.com/JeffreyXiang/CuMesh) -- Original CUDA mesh library
- [JeffreyXiang/FlexGEMM](https://github.com/JeffreyXiang/FlexGEMM) -- Triton sparse convolutions
