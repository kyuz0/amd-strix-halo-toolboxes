"""nvdiffrast.torch stub -- rendering functions disabled on ROCm.

nvdiffrast requires CUDA-specific OpenGL interop that has no ROCm equivalent.
This stub satisfies the import so TRELLIS.2 loads, but raises NotImplementedError
if any rendering function is actually called. Mesh export (GLB/OBJ/STL) works
without nvdiffrast; only the real-time preview renderer is affected.
"""
import torch


class RasterizeCudaContext:
    def __init__(self, *args, **kwargs):
        raise NotImplementedError(
            "nvdiffrast not available on ROCm. Use mesh export instead of rendering."
        )


def rasterize(*args, **kwargs):
    raise NotImplementedError("nvdiffrast rasterize not available on ROCm")


def interpolate(*args, **kwargs):
    raise NotImplementedError("nvdiffrast interpolate not available on ROCm")


def antialias(*args, **kwargs):
    raise NotImplementedError("nvdiffrast antialias not available on ROCm")


def texture(*args, **kwargs):
    raise NotImplementedError("nvdiffrast texture not available on ROCm")
