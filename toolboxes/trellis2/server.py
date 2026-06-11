"""TRELLIS.2 HTTP API server for the LLM fleet — AMD gfx1151 (RDNA4) compatible."""
import os
import io
import sys
import time
import logging
import tempfile

sys.path.insert(0, "/app/trellis2")
os.environ.setdefault("HF_HOME", "/hf-models/hf_cache")

import torch
import uvicorn
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import JSONResponse, FileResponse, HTMLResponse
from PIL import Image

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("trellis2-api")

app = FastAPI(title="TRELLIS.2 3D Generation API", version="1.0.0")
pipeline = None


def apply_amd_fixes():
    """Apply runtime fixes for AMD gfx1151 (RDNA4) GPUs.
    
    Fixes:
    1. FlexGEMM tf32 precision: Not supported on AMD Triton. Set to ieee.
    2. BiRefNet: FP16 weights vs FP32 input mismatch. Force model to fp32.
    3. CuMesh fill_holes: HIP kernel crash on gfx1151. Fallback to pymeshfix.
    """
    # FIX 1: FlexGEMM — disable tf32 (AMD Triton only supports: ieee, bf16x3, bf16x6)
    import flex_gemm.kernels.triton.spconv.config as flexgemm_config
    flexgemm_config.allow_tf32 = False
    logger.info("FlexGEMM: disabled tf32 → using ieee precision")

    # FIX 2: BiRefNet FP16/FP32 mismatch
    import importlib
    brm = importlib.import_module("trellis2.pipelines.rembg.BiRefNet")
    _orig_call = brm.BiRefNet.__call__
    def _fixed_call(self, image):
        self.model.float()
        return _orig_call(self, image)
    brm.BiRefNet.__call__ = _fixed_call
    logger.info("BiRefNet: patched fp32 cast")

    # FIX 3: CuMesh fill_holes crash → pymeshfix fallback
    import trellis2.representations.mesh.base as mesh_base
    _orig_fill_holes = mesh_base.Mesh.fill_holes
    def _safe_fill_holes(self, max_hole_perimeter=3e-2):
        try:
            _orig_fill_holes(self, max_hole_perimeter)
        except RuntimeError as e:
            if "CuMesh" in str(e) or "CUDA error" in str(e) or "invalid argument" in str(e):
                logger.warning("CuMesh fill_holes failed, using pymeshfix fallback: %s", e)
                try:
                    import pymeshfix
                    v = self.vertices.detach().cpu().numpy()
                    f = self.faces.detach().cpu().numpy()
                    fixer = pymeshfix.MeshFix(v, f)
                    fixer.repair(verbose=False)
                    self.vertices = torch.tensor(fixer.v, dtype=torch.float32, device=self.device)
                    self.faces = torch.tensor(fixer.f, dtype=torch.int32, device=self.device)
                except Exception as e2:
                    logger.warning("pymeshfix also failed, skipping hole fill: %s", e2)
            else:
                raise
    mesh_base.Mesh.fill_holes = _safe_fill_holes
    logger.info("CuMesh: patched fill_holes with pymeshfix fallback")


@app.on_event("startup")
async def load_model():
    global pipeline

    apply_amd_fixes()

    logger.info("Loading TRELLIS.2-4B...")
    from trellis2.pipelines import Trellis2ImageTo3DPipeline
    pipeline = Trellis2ImageTo3DPipeline.from_pretrained("microsoft/TRELLIS.2-4B")

    # FIX 4: sparse_structure_decoder fp32 — MIOpen fp16 3D Conv produces NaN on gfx1151
    pipeline.models['sparse_structure_decoder'].convert_to_fp32()
    logger.info("sparse_structure_decoder: converted to fp32")

    pipeline.to("cuda")
    logger.info("Model loaded on %s", torch.cuda.get_device_name(0))


@app.get("/health")
async def health():
    return {
        "status": "ok" if pipeline is not None else "loading",
        "service": "trellis2-3dgen",
        "model": "microsoft/TRELLIS.2-4B",
        "device": str(torch.cuda.get_device_name(0)) if torch.cuda.is_available() else "cpu",
        "vram_gb": round(torch.cuda.get_device_properties(0).total_memory / 1e9, 1) if torch.cuda.is_available() else 0,
    }


@app.post("/generate")
async def generate(
    image: UploadFile = File(...),
    seed: int = Form(default=0),
    output_format: str = Form(default="glb"),
    pipeline_type: str = Form(default="512"),
):
    if pipeline is None:
        return JSONResponse(status_code=503, content={"error": "Model still loading"})
    try:
        img_bytes = await image.read()
        img = Image.open(io.BytesIO(img_bytes)).convert("RGBA")
        logger.info(f"Generating 3D from {img.size}, seed={seed}, pipeline={pipeline_type}")

        t0 = time.time()
        outputs = pipeline.run(img, seed=seed, pipeline_type=pipeline_type)
        gen_time = time.time() - t0
        logger.info(f"Generated in {gen_time:.1f}s")

        mesh = outputs[0]
        with tempfile.NamedTemporaryFile(suffix=f".{output_format}", delete=False) as tmp:
            import trimesh
            v = mesh.vertices.detach().cpu().numpy() if torch.is_tensor(mesh.vertices) else mesh.vertices
            f = mesh.faces.detach().cpu().numpy() if torch.is_tensor(mesh.faces) else mesh.faces
            trimesh.Trimesh(vertices=v, faces=f).export(tmp.name)

            return FileResponse(tmp.name, media_type="application/octet-stream",
                                filename=f"trellis2_output.{output_format}")
    except Exception as e:
        logger.error(f"Generation failed: {e}", exc_info=True)
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.get("/admin")
async def admin():
    info = await health()
    return HTMLResponse(f"""<!DOCTYPE html><html><head><title>TRELLIS.2</title></head>
<body style="font-family:sans-serif;max-width:600px;margin:40px auto">
<h1>TRELLIS.2 3D Generation</h1>
<p>Status: <b>{info['status']}</b> | Device: {info['device']} | VRAM: {info['vram_gb']} GB</p>
<h2>API</h2>
<code>POST /generate</code> — multipart form: <code>image</code> (file), <code>seed</code> (int), <code>pipeline_type</code> (512|1024|1024_cascade)<br>
<code>GET /health</code> — health check</body></html>""")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8080)
