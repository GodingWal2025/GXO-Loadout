"""GPU pallet vision API: Cosmos target selection followed by SAM 3 segmentation."""

from __future__ import annotations

import asyncio
import os
import time
from contextlib import asynccontextmanager
from typing import AsyncIterator, Optional

import torch
from fastapi import FastAPI, Header, HTTPException, Request
from PIL import Image

from pipeline import PalletVisionPipeline, decode_data_url, load_image
from schemas import AnalyzeFacesRequest, LocatePalletRequest, ProposalRequest


SERVICE_KEY = os.environ.get("DETECTOR_SERVICE_KEY", "").strip()
ALLOW_UNAUTHENTICATED = os.environ.get("ALLOW_UNAUTHENTICATED", "false").lower() == "true"
MAX_IMAGE_BYTES = int(os.environ.get("MAX_IMAGE_BYTES", str(2 * 1024 * 1024)))
MAX_QUEUE_DEPTH = int(os.environ.get("MAX_QUEUE_DEPTH", "4"))

pipeline: PalletVisionPipeline | None = None
startup_error: str | None = None
gpu_lock = asyncio.Lock()
queue_guard = asyncio.Lock()
queued_requests = 0


def authorize(authorization: Optional[str]) -> None:
    if not SERVICE_KEY and not ALLOW_UNAUTHENTICATED:
        raise HTTPException(status_code=503, detail="DETECTOR_SERVICE_KEY is not configured")
    if SERVICE_KEY and authorization != f"Bearer {SERVICE_KEY}":
        raise HTTPException(status_code=401, detail="Unauthorized")


@asynccontextmanager
async def lifespan(_: FastAPI):
    global pipeline, startup_error
    try:
        pipeline = await asyncio.to_thread(PalletVisionPipeline)
        warm_image = Image.new("RGB", (512, 512), "white")
        await asyncio.to_thread(pipeline.sam3.segment, warm_image, "bag flap", [])
        deadline = time.monotonic() + float(os.environ.get("COSMOS_WARMUP_TIMEOUT_SECONDS", "600"))
        while True:
            location = await pipeline.locate(warm_image)
            if not location.reason or "failed" not in location.reason.lower():
                break
            if time.monotonic() >= deadline:
                raise RuntimeError(location.reason)
            await asyncio.sleep(5)
        if torch.cuda.is_available():
            torch.cuda.synchronize()
    except Exception as error:
        startup_error = str(error)
    yield
    pipeline = None


app = FastAPI(title="gxo-sam3-pallet-vision", lifespan=lifespan)


@asynccontextmanager
async def gpu_slot() -> AsyncIterator[None]:
    global queued_requests
    async with queue_guard:
        if queued_requests >= MAX_QUEUE_DEPTH:
            raise HTTPException(status_code=429, detail="GPU vision queue full", headers={"Retry-After": "3"})
        queued_requests += 1
    try:
        async with gpu_lock:
            yield
    finally:
        async with queue_guard:
            queued_requests -= 1


def require_pipeline() -> PalletVisionPipeline:
    if not pipeline:
        raise HTTPException(status_code=503, detail=startup_error or "Vision model warming up")
    return pipeline


def telemetry(started: float) -> dict:
    return {
        "gpuMemoryUsedMb": round(torch.cuda.memory_allocated() / 1024 / 1024) if torch.cuda.is_available() else 0,
        "queueDepth": queued_requests,
        "totalLatencyMs": round((time.perf_counter() - started) * 1000),
        "modelVersion": pipeline.version if pipeline else None,
    }


@app.get("/health")
async def health():
    return {"ready": pipeline is not None, "model": pipeline.version if pipeline else None,
            "startupError": startup_error, "queueDepth": queued_requests, "queueCapacity": MAX_QUEUE_DEPTH,
            "cuda": torch.cuda.is_available(),
            "gpuMemoryUsedMb": round(torch.cuda.memory_allocated() / 1024 / 1024) if torch.cuda.is_available() else 0}


@app.post("/analyze")
async def analyze(request: Request, authorization: Optional[str] = Header(None)):
    authorize(authorization)
    raw = await request.body()
    if not raw or len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image must be between 1 byte and MAX_IMAGE_BYTES")
    try:
        image = load_image(raw)
    except Exception as error:
        raise HTTPException(status_code=400, detail="Could not decode image") from error
    started = time.perf_counter()
    async with gpu_slot():
        result = await require_pipeline().analyze(image)
    result["telemetry"] = telemetry(started)
    return result


@app.post("/analyze-faces")
async def analyze_faces(body: AnalyzeFacesRequest, authorization: Optional[str] = Header(None)):
    authorize(authorization)
    started = time.perf_counter()
    try:
        images = [(item, decode_data_url(item.dataUrl)) for item in body.images]
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    async with gpu_slot():
        locations = await asyncio.gather(*(require_pipeline().locate(image, item.dataUrl) for item, image in images))
        faces = []
        for (item, image), location in zip(images, locations):
            if location.ambiguous or not location.box:
                result = {"success": False, "layers": None, "estimatedBags": None,
                          "needsReview": True, "reviewReason": location.reason or "Ambiguous pallet",
                          "isPalletFace": False, "palletBox": list(location.box) if location.box else None,
                          "boxes": [], "masks": [], "displayPolygons": [], "maskCount": 0}
            else:
                instances = await asyncio.to_thread(require_pipeline().propose, image, location.box, [], "bag flap")
                result = require_pipeline().reduce_instances(image, location.box, instances)
            faces.append({"index": item.index, "slotKey": item.slotKey,
                          "bagFlaps": result.get("estimatedBags"), "layers": result.get("layers"),
                          "isPalletFace": result.get("isPalletFace", False), "needsReview": result.get("needsReview", False),
                          "reviewReason": result.get("reviewReason"), "flapBoxes": result.get("boxes", []),
                          "palletBox": result.get("palletBox"), "boxCount": result.get("maskCount", 0),
                          "masks": result.get("masks", []), "displayPolygons": result.get("displayPolygons", []),
                          "countMatchesBoxes": True, "error": None})
    valid = [face for face in faces if not face["needsReview"] and face["layers"] is not None]
    layer_counts: dict[int, int] = {}
    for face in valid:
        layer_counts[face["layers"]] = layer_counts.get(face["layers"], 0) + 1
    best_votes = max(layer_counts.values(), default=0)
    tied = sum(1 for count in layer_counts.values() if count == best_votes) > 1
    overall_review = len(valid) < 3 or tied or any(face["needsReview"] for face in faces)
    visible = sum(face["bagFlaps"] or 0 for face in valid)
    return {"success": len(valid) > 0, "needsReview": overall_review,
            "reviewReason": "Fewer than three unambiguous faces or no layer majority" if overall_review else None,
            "faces": faces, "visibleBagTotal": visible if valid else None,
            "visibleBagTotalFromBoxes": visible if valid else None, "topLayerFull": True,
            "gaps": False, "damage": False, "confidence": None, "modelVersion": require_pipeline().version,
            "imageCount": len(images), "failedFaces": len(images) - len(valid), "telemetry": telemetry(started)}


@app.post("/propose-flaps")
async def propose_flaps(body: ProposalRequest, authorization: Optional[str] = Header(None)):
    authorize(authorization)
    image = decode_data_url(body.image)
    started = time.perf_counter()
    async with gpu_slot():
        instances = await asyncio.to_thread(require_pipeline().propose, image, body.targetPalletBox,
                                            body.promptBoxes, body.textPrompt)
    return {"success": True,
            "instances": [{"id": item.id, "score": item.score, "bbox": item.bbox,
                           "segmentationRle": item.segmentation_rle,
                           "displayPolygon": item.display_polygon} for item in instances],
            "modelVersion": require_pipeline().version, "telemetry": telemetry(started)}


@app.post("/locate-pallet")
async def locate_pallet(body: LocatePalletRequest, authorization: Optional[str] = Header(None)):
    authorize(authorization)
    image = decode_data_url(body.image)
    started = time.perf_counter()
    async with gpu_slot():
        location = await require_pipeline().locate(image, body.image)
    return {"success": location.box is not None and not location.ambiguous,
            "targetPalletBox": list(location.box) if location.box else None,
            "confidence": location.confidence, "multiplePalletsVisible": location.multiple_visible,
            "targetAmbiguous": location.ambiguous, "targetSelectionReason": location.selection_reason,
            "reviewReason": location.reason, "modelVersion": require_pipeline().cosmos.version,
            "telemetry": telemetry(started)}
