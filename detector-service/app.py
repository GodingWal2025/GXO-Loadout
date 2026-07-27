"""
Pallet bag-count inference service (RF-DETR, Apache-2.0).

Vision backend the Azure Function's /api/analyze-pallet-count proxies to. Uses
Roboflow's RF-DETR object detector (Apache-2.0 — no copyleft, no license fee, safe
in the closed-source commercial app) instead of AGPL YOLO26. It detects bags on
the visible pallet face and derives the same JSON contract the client consumes:

    { success, layers, topLayerFull, gaps, damage,
      estimatedBags, confidence, rationale, modelVersion }

Honest limits (unchanged by model choice — see memory bag-count-cosmos-nim):
  * A detector sees only the FRONT + TOP faces. Interior bags are occluded, so
    `estimatedBags` is the VISIBLE-face count, not the pallet total. The client
    still does `layers x bagsPerLayer` for the real number; this is a cross-check.
  * The pretrained model is COCO-trained and has no "stacked bag" class. Point
    RFDETR_WEIGHTS at a checkpoint fine-tuned on your bags. RF-DETR class ids are
    dataset-specific, so give the ordered class names via RFDETR_CLASS_NAMES.
  * gaps / damage are only meaningful if your fine-tuned model has those classes
    (RFDETR_GAP_CLASSES / RFDETR_DAMAGE_CLASSES); otherwise they default to false.

Env:
  RFDETR_WEIGHTS       path to fine-tuned .pth checkpoint   (default: COCO base)
  RFDETR_CONF          confidence threshold                 (default: 0.5)
  RFDETR_RESOLUTION    inference resolution, mult. of 56    (default: model default)
  RFDETR_CLASS_NAMES   ordered comma-sep names, id 0..N-1   (default: model names)
  RFDETR_BAG_CLASSES   comma-sep names counted as bags      (default: all)
  RFDETR_GAP_CLASSES   comma-sep names meaning a gap        (default: none)
  RFDETR_DAMAGE_CLASSES comma-sep names meaning damage      (default: none)
  DETECTOR_SERVICE_KEY if set, require Authorization: Bearer <key>
"""

import io
import os
import statistics
from typing import Optional

from fastapi import FastAPI, Header, HTTPException, Request
from PIL import Image

from rfdetr import RFDETRBase

# --- config ---------------------------------------------------------------
WEIGHTS = os.environ.get("RFDETR_WEIGHTS", "").strip()
CONF = float(os.environ.get("RFDETR_CONF", "0.5"))
RESOLUTION = os.environ.get("RFDETR_RESOLUTION", "").strip()
SERVICE_KEY = os.environ.get("DETECTOR_SERVICE_KEY", "").strip()


def _class_list(var: str) -> list[str]:
    return [c.strip() for c in os.environ.get(var, "").split(",") if c.strip()]


def _class_set(var: str) -> set[str]:
    return {c.lower() for c in _class_list(var)}


CLASS_NAMES = _class_list("RFDETR_CLASS_NAMES")  # ordered: index == class_id
BAG_CLASSES = _class_set("RFDETR_BAG_CLASSES")
GAP_CLASSES = _class_set("RFDETR_GAP_CLASSES")
DAMAGE_CLASSES = _class_set("RFDETR_DAMAGE_CLASSES")

# Load once at startup; the process stays warm between requests.
_kwargs = {}
if WEIGHTS:
    _kwargs["pretrain_weights"] = WEIGHTS
if RESOLUTION:
    _kwargs["resolution"] = int(RESOLUTION)
model = RFDETRBase(**_kwargs)
model.optimize_for_inference()  # fuses/compiles for faster repeated predict()

MODEL_VERSION = f"rf-detr:{os.path.basename(WEIGHTS) if WEIGHTS else 'base-coco'}"

# Prefer explicit env names; fall back to whatever the model exposes.
_model_names = getattr(model, "class_names", None) or {}


def _name_for(class_id: int) -> str:
    if CLASS_NAMES and 0 <= class_id < len(CLASS_NAMES):
        return CLASS_NAMES[class_id]
    if isinstance(_model_names, dict):
        return str(_model_names.get(class_id, class_id))
    if isinstance(_model_names, (list, tuple)) and 0 <= class_id < len(_model_names):
        return str(_model_names[class_id])
    return str(class_id)


app = FastAPI(title="pallet-bag-count-rfdetr")


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_VERSION, "names": CLASS_NAMES or _model_names}


def _estimate_layers(boxes: list[tuple[float, float, float, float]]) -> int:
    """
    Cluster detected boxes into horizontal courses (layers) by vertical position.

    Bags in one layer share a similar box-center Y. Sort centers top to bottom and
    start a new layer whenever the gap to the previous center exceeds ~60% of the
    median box height (a robust, scale-free row threshold).
    """
    if not boxes:
        return 0

    centers = [((y1 + y2) / 2.0, abs(y2 - y1)) for x1, y1, x2, y2 in boxes]
    centers.sort(key=lambda c: c[0])

    median_h = statistics.median(h for _, h in centers) or 1.0
    threshold = 0.6 * median_h

    layers = 1
    prev_cy = centers[0][0]
    for cy, _ in centers[1:]:
        if cy - prev_cy > threshold:
            layers += 1
        prev_cy = cy
    return layers


@app.post("/analyze")
async def analyze(request: Request, authorization: Optional[str] = Header(None)):
    if SERVICE_KEY and authorization != f"Bearer {SERVICE_KEY}":
        raise HTTPException(status_code=401, detail="Unauthorized")

    raw = await request.body()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty request body (expected image bytes)")

    try:
        img = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="Could not decode image")

    # RF-DETR returns a supervision.Detections: .xyxy (N,4), .confidence, .class_id
    detections = model.predict(img, threshold=CONF)

    bag_boxes: list[tuple[float, float, float, float]] = []
    confs: list[float] = []
    gaps = False
    damage = False

    for i in range(len(detections)):
        cls_name = _name_for(int(detections.class_id[i])).lower()
        conf = float(detections.confidence[i])
        if GAP_CLASSES and cls_name in GAP_CLASSES:
            gaps = True
            continue
        if DAMAGE_CLASSES and cls_name in DAMAGE_CLASSES:
            damage = True
            continue
        # A bag: matches the configured bag classes, or (if none configured)
        # every remaining detection counts as a bag.
        if not BAG_CLASSES or cls_name in BAG_CLASSES:
            x1, y1, x2, y2 = (float(v) for v in detections.xyxy[i])
            bag_boxes.append((x1, y1, x2, y2))
            confs.append(conf)

    visible_bags = len(bag_boxes)
    layers = _estimate_layers(bag_boxes)
    mean_conf = round(statistics.mean(confs), 3) if confs else None
    per_layer = round(visible_bags / layers, 1) if layers else None

    rationale_bits = [f"Detected {visible_bags} bags on the visible face across ~{layers} layer(s)"]
    if per_layer:
        rationale_bits.append(f"(~{per_layer}/layer)")
    if not (GAP_CLASSES or DAMAGE_CLASSES):
        rationale_bits.append("; gaps/damage not modeled by these weights")
    rationale = " ".join(rationale_bits) + "."

    return {
        "success": True,
        "layers": layers or None,
        "topLayerFull": True,  # a detector can't judge a partial top course; verifier confirms
        "gaps": gaps,
        "damage": damage,
        # Visible-face count only — interior bags are occluded. Client uses
        # layers x bagsPerLayer for the real total; this is a cross-check.
        "estimatedBags": visible_bags or None,
        "confidence": mean_conf,
        "rationale": rationale,
        "modelVersion": MODEL_VERSION,
    }
