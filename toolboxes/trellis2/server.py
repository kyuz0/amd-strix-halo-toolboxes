"""TRELLIS.2 HTTP API server — image-to-3D generation on AMD ROCm."""
import os
import io
import sys
import json
import base64
import tempfile
import logging
from pathlib import Path

sys.path.insert(0, "/app/trellis2")

import torch
import uvicorn
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import JSONResponse, FileResponse
from PIL import Image

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("trellis2-api")

app = FastAPI(title="TRELLIS.2 3D Generation API", version="1.0.0")

pipeline = None
MODEL_ID = os.environ.get("TRELLIS_MODEL", "microsoft/TRELLIS.2-4B")

@app.on_event("startup")
async def load_model():
    global pipeline
    logger.info(f"Loading TRELLIS.2 model: {MODEL_ID}")
    from trellis2.pipelines import Trellis2ImageTo3DPipeline
    pipeline = Trellis2ImageTo3DPipeline.from_pretrained(MODEL_ID)
    pipeline.to("cuda")
    logger.info("Model loaded successfully")

@app.get("/health")
async def health():
    return {
        "status": "ok" if pipeline is not None else "loading",
        "service": "trellis2-3dgen",
        "model": MODEL_ID,
        "device": str(torch.cuda.get_device_name(0)) if torch.cuda.is_available() else "cpu",
        "vram_gb": round(torch.cuda.get_device_properties(0).total_mem / 1e9, 1) if torch.cuda.is_available() else 0,
    }

@app.post("/generate")
async def generate(
    image: UploadFile = File(...),
    seed: int = Form(default=0),
    steps: int = Form(default=50),
    cfg_strength: float = Form(default=7.5),
    output_format: str = Form(default="glb"),
):
    """Generate a 3D model from an input image."""
    if pipeline is None:
        return JSONResponse(status_code=503, content={"error": "Model still loading"})

    try:
        img_bytes = await image.read()
        img = Image.open(io.BytesIO(img_bytes)).convert("RGBA")

        logger.info(f"Generating 3D from image ({img.size}), seed={seed}, steps={steps}")

        outputs = pipeline.run(
            img,
            seed=seed,
            steps=steps,
            cfg_strength=cfg_strength,
        )

        with tempfile.NamedTemporaryFile(suffix=f".{output_format}", delete=False) as tmp:
            if output_format in ("glb", "obj", "stl"):
                outputs["mesh"].export(tmp.name)
            else:
                return JSONResponse(status_code=400, content={"error": f"Unsupported format: {output_format}"})

            return FileResponse(
                tmp.name,
                media_type="application/octet-stream",
                filename=f"trellis2_output.{output_format}",
            )

    except Exception as e:
        logger.error(f"Generation failed: {e}", exc_info=True)
        return JSONResponse(status_code=500, content={"error": str(e)})

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8080)
