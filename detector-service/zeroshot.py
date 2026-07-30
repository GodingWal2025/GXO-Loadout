"""
Zero-shot open-vocabulary bag detection (OWLv2, Apache-2.0).

The RF-DETR path in app.py needs a checkpoint fine-tuned on pallet photos; until
that exists it loads COCO base, which has no bag class and returns nothing useful.
This backend fills that gap: OWLv2 detects objects from *text prompts* ("a bag of
seed"), so it works with no training data at all.

    MEASURED RESULT ON REAL GXO PALLETS (2026-07-29, Bags_Phots set): this does
    NOT produce usable bag boxes on shrink-wrapped seed pallets. Across prompt
    sets ("a bag of seed" / "a white bag" / "a sack") and thresholds 0.05-0.20,
    boxes either span several stack layers at once or collapse onto the DEKALB
    logo, and counts swing from 2 to 104 on one image with ~12 visible bags.
    Reframing the prompts to find LAYERS rather than bags did not help.

    Keep this module for what it is actually good for — a rough first pass to
    correct when labeling, and a working end-to-end wiring test — not for counts
    anyone should read. Production accuracy needs the fine-tuned RF-DETR path.

License: google/owlv2-base-patch16-ensemble is Apache-2.0 — same commercial-use
story as RF-DETR, no copyleft, safe in the closed-source GXO app.

Env:
  OWL_MODEL    HF model id           (default: google/owlv2-base-patch16-ensemble)
  OWL_PROMPTS  comma-sep text queries(default: "a bag of seed,a sack,a bag")
  OWL_CONF     score threshold       (default: 0.20 — OWLv2 scores run low)
  OWL_IOU      NMS IoU threshold     (default: 0.50)
"""

import os
from dataclasses import dataclass

import torch
from PIL import Image
from transformers import Owlv2ForObjectDetection, Owlv2Processor

DEFAULT_MODEL = "google/owlv2-base-patch16-ensemble"
DEFAULT_PROMPTS = "a bag of seed,a sack,a bag"


@dataclass
class Detection:
    """Backend-agnostic box. app.py's analysis code consumes only this."""
    x1: float
    y1: float
    x2: float
    y2: float
    score: float
    name: str


def _iou(a: Detection, b: Detection) -> float:
    ix1, iy1 = max(a.x1, b.x1), max(a.y1, b.y1)
    ix2, iy2 = min(a.x2, b.x2), min(a.y2, b.y2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    area_a = max(0.0, a.x2 - a.x1) * max(0.0, a.y2 - a.y1)
    area_b = max(0.0, b.x2 - b.x1) * max(0.0, b.y2 - b.y1)
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def nms(dets: list[Detection], iou_thresh: float) -> list[Detection]:
    """
    Greedy NMS. Required here because we run SEVERAL prompts over one image and
    every prompt fires on the same physical bag — without this, a bag detected by
    both "a sack" and "a bag" is counted twice.
    """
    kept: list[Detection] = []
    for d in sorted(dets, key=lambda x: x.score, reverse=True):
        if all(_iou(d, k) <= iou_thresh for k in kept):
            kept.append(d)
    return kept


class Owlv2Detector:
    """Lazy-loaded so importing this module costs nothing when the backend is off."""

    def __init__(self) -> None:
        self.model_id = os.environ.get("OWL_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL
        self.prompts = [
            p.strip()
            for p in os.environ.get("OWL_PROMPTS", DEFAULT_PROMPTS).split(",")
            if p.strip()
        ]
        self.conf = float(os.environ.get("OWL_CONF", "0.20"))
        self.iou = float(os.environ.get("OWL_IOU", "0.50"))

        self.processor = Owlv2Processor.from_pretrained(self.model_id)
        self.model = Owlv2ForObjectDetection.from_pretrained(self.model_id)
        self.model.eval()

        self.version = f"owlv2-zeroshot:{self.model_id.split('/')[-1]}"

    @torch.inference_mode()
    def detect(self, image: Image.Image) -> list[Detection]:
        inputs = self.processor(text=[self.prompts], images=image, return_tensors="pt")
        outputs = self.model(**inputs)

        # OWLv2 pads the image to a SQUARE (bottom/right) before resizing, and
        # returns boxes normalized to that padded square. So the correct
        # target_size is (side, side) with side = max(h, w) — passing the real
        # (h, w) here is the classic OWLv2 bug that skews every box.
        side = max(image.height, image.width)
        target_sizes = torch.tensor([[side, side]])

        # transformers renamed this for open-vocabulary models; accept either so
        # the service isn't pinned to one release.
        post_process = getattr(
            self.processor,
            "post_process_grounded_object_detection",
            None,
        ) or self.processor.post_process_object_detection

        results = post_process(
            outputs=outputs, threshold=self.conf, target_sizes=target_sizes
        )[0]

        dets: list[Detection] = []
        for score, label, box in zip(results["scores"], results["labels"], results["boxes"]):
            x1, y1, x2, y2 = (float(v) for v in box)
            # Clip back into the real (unpadded) image and drop anything that
            # landed entirely in the pad region.
            x1, x2 = max(0.0, x1), min(float(image.width), x2)
            y1, y2 = max(0.0, y1), min(float(image.height), y2)
            if x2 - x1 < 1 or y2 - y1 < 1:
                continue
            idx = int(label)
            name = self.prompts[idx] if 0 <= idx < len(self.prompts) else str(idx)
            dets.append(Detection(x1, y1, x2, y2, float(score), name))

        return nms(dets, self.iou)
