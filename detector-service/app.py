"""
Pallet bag-count inference service.

Vision backend the Azure Function's /api/analyze-pallet-count proxies to. Detects
bags on the visible pallet face and derives the JSON contract the client consumes:

    { success, layers, topLayerFull, gaps, damage,
      estimatedBags, confidence, rationale, modelVersion }

Two interchangeable detection backends (DETECTOR_BACKEND):

  rfdetr  (default, production) Roboflow RF-DETR, Apache-2.0 — no copyleft, no
          license fee, safe in the closed-source app. Needs a checkpoint
          FINE-TUNED on pallet photos; the COCO base has no bag class.
  owlv2   (demo/bootstrap) Open-vocabulary OWLv2, Apache-2.0. Detects from text
          prompts, so it needs NO training data — this is what makes an
          end-to-end demo possible before any labeling happens. Less accurate on
          tight stacks; see zeroshot.py.

Honest limits (independent of backend):
  * A detector sees only the FRONT + TOP faces. Interior bags are occluded, so
    `estimatedBags` is the VISIBLE-face count, not the pallet total. The client
    still does `layers x bagsPerLayer` for the real number; this is a cross-check.
  * gaps / damage are only meaningful if your fine-tuned model has those classes
    (RFDETR_GAP_CLASSES / RFDETR_DAMAGE_CLASSES); otherwise they default to false.

Env:
  DETECTOR_BACKEND     "rfdetr" | "owlv2"                    (default: rfdetr)
  RFDETR_WEIGHTS       path to fine-tuned .pth checkpoint    (default: COCO base)
  RFDETR_MODEL_SIZE    nano|small|medium|base|large           (default: small)
  RFDETR_CONF          confidence threshold                  (default: 0.5)
  RFDETR_RESOLUTION    inference resolution, mult. of 56     (default: model default)
  RFDETR_CLASS_NAMES   ordered comma-sep names, id 0..N-1    (default: model names)
  RFDETR_BAG_CLASSES   comma-sep names counted as bags       (default: all)
  RFDETR_GAP_CLASSES   comma-sep names meaning a gap         (default: none)
  RFDETR_DAMAGE_CLASSES comma-sep names meaning damage       (default: none)
  DETECTOR_SERVICE_KEY if set, require Authorization: Bearer <key>
  (OWLv2 knobs: OWL_MODEL / OWL_PROMPTS / OWL_CONF / OWL_IOU — see zeroshot.py)
"""

import io
import os
import statistics
from typing import Optional

from fastapi import FastAPI, Header, HTTPException, Request
from PIL import Image, ImageOps

from zeroshot import Detection
from geometry import estimate_layers, normalize_boxes
from rfdetr_model import create_rfdetr_model

# --- config ---------------------------------------------------------------
BACKEND = (os.environ.get("DETECTOR_BACKEND", "rfdetr").strip().lower() or "rfdetr")
WEIGHTS = os.environ.get("RFDETR_WEIGHTS", "").strip()
CONF = float(os.environ.get("RFDETR_CONF", "0.5"))
RESOLUTION = os.environ.get("RFDETR_RESOLUTION", "").strip()
MODEL_SIZE = (os.environ.get("RFDETR_MODEL_SIZE", "small").strip().lower() or "small")
SERVICE_KEY = os.environ.get("DETECTOR_SERVICE_KEY", "").strip()


def _class_list(var: str) -> list[str]:
    return [c.strip() for c in os.environ.get(var, "").split(",") if c.strip()]


def _class_set(var: str) -> set[str]:
    return {c.lower() for c in _class_list(var)}


CLASS_NAMES = _class_list("RFDETR_CLASS_NAMES")  # ordered: index == class_id
BAG_CLASSES = _class_set("RFDETR_BAG_CLASSES")
GAP_CLASSES = _class_set("RFDETR_GAP_CLASSES")
DAMAGE_CLASSES = _class_set("RFDETR_DAMAGE_CLASSES")

# --- backend load (once at startup; the process stays warm) ----------------
# Imported lazily per backend so the demo path doesn't require the rfdetr wheel
# (and the production path doesn't require transformers).
_rf_model = None
_owl = None

if BACKEND == "owlv2":
    from zeroshot import Owlv2Detector

    _owl = Owlv2Detector()
    MODEL_VERSION = _owl.version
else:
    _kwargs = {}
    if WEIGHTS:
        _kwargs["pretrain_weights"] = WEIGHTS
    if RESOLUTION:
        _kwargs["resolution"] = int(RESOLUTION)
    _rf_model = create_rfdetr_model(MODEL_SIZE, **_kwargs)
    _rf_model.optimize_for_inference()  # fuses/compiles for faster repeated predict()
    MODEL_VERSION = f"rf-detr-{MODEL_SIZE}:{os.path.basename(WEIGHTS) if WEIGHTS else 'coco'}"

# Prefer explicit env names; fall back to whatever the model exposes.
_model_names = getattr(_rf_model, "class_names", None) or {}


def _name_for(class_id: int) -> str:
    if CLASS_NAMES and 0 <= class_id < len(CLASS_NAMES):
        return CLASS_NAMES[class_id]
    if isinstance(_model_names, dict):
        return str(_model_names.get(class_id, class_id))
    if isinstance(_model_names, (list, tuple)) and 0 <= class_id < len(_model_names):
        return str(_model_names[class_id])
    return str(class_id)


def detect(img: Image.Image) -> list[Detection]:
    """Run the configured backend and normalize to Detection boxes."""
    if _owl is not None:
        return _owl.detect(img)

    # RF-DETR returns a supervision.Detections: .xyxy (N,4), .confidence, .class_id
    detections = _rf_model.predict(img, threshold=CONF)
    out: list[Detection] = []
    for i in range(len(detections)):
        x1, y1, x2, y2 = (float(v) for v in detections.xyxy[i])
        out.append(
            Detection(
                x1, y1, x2, y2,
                float(detections.confidence[i]),
                _name_for(int(detections.class_id[i])),
            )
        )
    return out


def load_image(raw: bytes) -> Image.Image:
    """
    Decode uploaded bytes into an UPRIGHT RGB image.

    exif_transpose is not optional: phone cameras store landscape sensor data
    plus an orientation tag, so a portrait pallet photo decodes sideways. Layer
    clustering below groups boxes by vertical position, which is meaningless on
    a 90-degree-rotated frame.
    """
    img = Image.open(io.BytesIO(raw))
    img = ImageOps.exif_transpose(img)
    return img.convert("RGB")


app = FastAPI(title="pallet-bag-count")


@app.get("/health")
def health():
    return {
        "ok": True,
        "backend": BACKEND,
        "model": MODEL_VERSION,
        "names": CLASS_NAMES or _model_names,
        **({"prompts": _owl.prompts} if _owl else {}),
    }


def analyze_image(img: Image.Image) -> dict:
    """Detection -> the client's JSON contract. Shared by /analyze and demo.py."""
    detections = detect(img)

    bag_boxes: list[tuple[float, float, float, float]] = []
    confs: list[float] = []
    gaps = False
    damage = False

    for d in detections:
        cls_name = d.name.lower()
        if GAP_CLASSES and cls_name in GAP_CLASSES:
            gaps = True
            continue
        if DAMAGE_CLASSES and cls_name in DAMAGE_CLASSES:
            damage = True
            continue
        # A bag: matches the configured bag classes, or (if none configured)
        # every remaining detection counts as a bag.
        if not BAG_CLASSES or cls_name in BAG_CLASSES:
            bag_boxes.append((d.x1, d.y1, d.x2, d.y2))
            confs.append(d.score)

    visible_bags = len(bag_boxes)
    layers = estimate_layers(bag_boxes)
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
        "boxes": normalize_boxes(bag_boxes, img.width, img.height),
        "confidence": mean_conf,
        "rationale": rationale,
        "modelVersion": MODEL_VERSION,
    }


@app.post("/analyze")
async def analyze(request: Request, authorization: Optional[str] = Header(None)):
    if SERVICE_KEY and authorization != f"Bearer {SERVICE_KEY}":
        raise HTTPException(status_code=401, detail="Unauthorized")

    raw = await request.body()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty request body (expected image bytes)")

    try:
        img = load_image(raw)
    except Exception:
        raise HTTPException(status_code=400, detail="Could not decode image")

    return analyze_image(img)
