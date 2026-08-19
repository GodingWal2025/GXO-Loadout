"""
Production Bag Counting Vision Service (Two-Model Architecture)

Runs on dual NVIDIA GPUs:
  • GPU 0: Qwen2.5-VL Visual Reasoning Service (4-image multi-view layer consensus)
  • GPU 1: Meta SAM (Segment Anything) (high-resolution bag-flap segmentation)
  • CPU: Deterministic SKU Recipe Reconciliation Engine

Endpoints:
  • POST /api/v1/analyze-pallet (Primary production endpoint)
  • POST /analyze-pallet-count (Legacy proxy compatibility)
  • GET  /api/v1/health
"""

from __future__ import annotations

import base64
import io
import os
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image

from vlm_reason2 import VLMReasonService
from sam3_detector import SAMDetectorService
from reconciliation import reconcile_pallet_evidence

app = FastAPI(
    title="GXO Bag Counting Two-Model Detector Service",
    version="2.0.0",
    description="Multi-view VLM (GPU 0) + SAM (GPU 1) with SKU Recipe Reconciliation"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SERVICE_KEY = os.environ.get("DETECTOR_SERVICE_KEY", "").strip()

# Lazy model singletons
vlm_service: VLMReasonService | None = None
sam_service: SAMDetectorService | None = None


def get_vlm_service() -> VLMReasonService:
    global vlm_service
    if vlm_service is None:
        vlm_service = VLMReasonService(
            model_id=os.environ.get("VLM_MODEL_ID", "nvidia/Cosmos-Reason2-8B"),
            device=os.environ.get("VLM_DEVICE", "cuda:0")
        )
    return vlm_service


def get_sam_service() -> SAMDetectorService:
    global sam_service
    if sam_service is None:
        sam_service = SAMDetectorService(
            checkpoint_path=os.environ.get("SAM_CHECKPOINT", "/workspace/models/sam/sam2.1_hiera_large.pt"),
            model_cfg=os.environ.get("SAM_CONFIG", "configs/sam2.1/sam2.1_hiera_l.yaml"),
            device=os.environ.get("SAM_DEVICE", "cuda:1")
        )
    return sam_service


def check_auth(authorization: str | None) -> None:
    if not SERVICE_KEY:
        return
    if not authorization or authorization.strip() != f"Bearer {SERVICE_KEY}":
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.get("/api/v1/health")
@app.get("/healthz")
async def health():
    return {
        "status": "healthy",
        "service": "gxo-bag-count-detector",
        "version": "2.0.0",
        "gpu_0": "NVIDIA-Cosmos-Reason2-8B",
        "gpu_1": "Meta-SAM-3-Large"
    }


def parse_image_from_payload(item: Any) -> Image.Image:
    """Extract PIL Image from Base64 string or bytes."""
    if isinstance(item, str):
        b64_clean = item.split(",")[-1]
        data = base64.b64decode(b64_clean)
        return Image.open(io.BytesIO(data)).convert("RGB")
    elif isinstance(item, bytes):
        return Image.open(io.BytesIO(item)).convert("RGB")
    raise ValueError("Invalid image payload format")


@app.post("/api/v1/analyze-pallet")
async def analyze_pallet(
    request: Request,
    authorization: str | None = Header(None)
):
    """Analyze a 4-side pallet photo payload with SKU Stacking Recipe."""
    check_auth(authorization)
    
    body = await request.json()
    images_raw = body.get("images", {})
    recipe = body.get("recipe", {})
    
    # Standardize 4 sides: FRONT, RIGHT, BACK, LEFT
    images_dict: dict[str, Image.Image] = {}
    for face in ["front", "right", "back", "left"]:
        img_val = images_raw.get(face) or images_raw.get(face.upper())
        if not img_val:
            raise HTTPException(
                status_code=400,
                detail=f"Missing required photo for face: {face.upper()}"
            )
        try:
            images_dict[face] = parse_image_from_payload(img_val)
        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail=f"Could not decode image for {face.upper()}: {e}"
            )

    # 1. Multi-View Structural Reasoning on GPU 0
    vlm = get_vlm_service()
    vlm_result = vlm.analyze_multiview(images_dict, recipe)

    # 2. SAM Bag-Flap Segmentation on GPU 1
    sam = get_sam_service()
    layer_bounds = vlm_result.get("layerBounds")
    sam_flaps_by_face: dict[str, list[dict[str, Any]]] = {}
    
    for face, img in images_dict.items():
        try:
            flaps = sam.segment_flaps_in_layer_bands(img, layer_bounds)
            sam_flaps_by_face[face] = flaps
        except Exception as e:
            print(f"[!] SAM segmentation warning on face {face}: {e}")
            sam_flaps_by_face[face] = []

    # 3. Deterministic Evidence Triangulation
    reconciliation = reconcile_pallet_evidence(
        vlm_result=vlm_result,
        sam_flaps_by_face=sam_flaps_by_face,
        recipe=recipe
    )

    return {
        "success": True,
        "modelVersion": "gxo-vlm-sam-v2",
        "analysis": reconciliation,
        "vlm_raw": vlm_result,
        "sam_flaps": {face: len(flaps) for face, flaps in sam_flaps_by_face.items()}
    }


@app.post("/analyze-pallet-count")
async def analyze_pallet_count_legacy(
    request: Request,
    authorization: str | None = Header(None)
):
    """Legacy endpoint adapter for single/multi-view requests."""
    check_auth(authorization)
    body = await request.json()
    
    # If legacy single image, wrap into 4-face dict
    if "image" in body and "images" not in body:
        img_val = body["image"]
        body["images"] = {
            "front": img_val,
            "right": img_val,
            "back": img_val,
            "left": img_val
        }
        
    return await analyze_pallet(request, authorization)


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
