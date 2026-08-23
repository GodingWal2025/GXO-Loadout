from __future__ import annotations

import base64
import asyncio
import io
import os
import statistics
import time
import uuid
from dataclasses import dataclass, field
from typing import Protocol

import cv2
import numpy as np
from PIL import Image, ImageOps
from pycocotools import mask as mask_util

from cosmos_client import CosmosPalletLocator, PalletLocation
from geometry import RectifiedPallet, estimate_layers, prompt_in_crop, rectify_pallet_face, suppress_overlapping
from sam3_model import Sam3BagFlapModel, Sam3Mask
from schemas import NormalizedBox


@dataclass
class EncodedInstance:
    id: str
    score: float
    bbox: list[float]
    segmentation_rle: dict
    display_polygon: list[list[float]]


@dataclass
class CounterPrediction:
    """Model-neutral result boundary for SAM3 and future specialist counters."""
    masks: list[Sam3Mask] = field(default_factory=list)
    density_count: float | None = None
    bag_centers: list[tuple[float, float]] = field(default_factory=list)
    count_class: int | None = None
    consensus_count: int | None = None
    confidence: float | None = None


class PalletFaceCounter(Protocol):
    version: str

    def predict(
        self, image: Image.Image, text_prompt: str,
        prompt_boxes: list[tuple[float, float, float, float]],
    ) -> CounterPrediction: ...


class Sam3Counter:
    """Adapter that keeps the pipeline independent from the current counter model."""

    def __init__(self, model: Sam3BagFlapModel | None = None) -> None:
        self.model = model or Sam3BagFlapModel()
        self.version = self.model.version

    def predict(
        self, image: Image.Image, text_prompt: str,
        prompt_boxes: list[tuple[float, float, float, float]],
    ) -> CounterPrediction:
        return CounterPrediction(masks=self.model.segment(image, text_prompt, prompt_boxes))


def decode_data_url(data_url: str) -> Image.Image:
    try:
        _, encoded = data_url.split(",", 1)
        raw = base64.b64decode(encoded, validate=True)
        if len(raw) > int(os.environ.get("MAX_IMAGE_BYTES", str(2 * 1024 * 1024))):
            raise ValueError("Image exceeds MAX_IMAGE_BYTES")
        return load_image(raw)
    except Exception as error:
        raise ValueError("Invalid image data URL") from error


def image_to_data_url(image: Image.Image) -> str:
    output = io.BytesIO()
    image.save(output, format="JPEG", quality=88)
    return "data:image/jpeg;base64," + base64.b64encode(output.getvalue()).decode("ascii")


def load_image(raw: bytes) -> Image.Image:
    image = ImageOps.exif_transpose(Image.open(io.BytesIO(raw)))
    image.load()
    if image.width * image.height > int(os.environ.get("MAX_IMAGE_PIXELS", "25000000")):
        raise ValueError("Decoded image exceeds MAX_IMAGE_PIXELS")
    return image.convert("RGB")


def _crop_box(box: NormalizedBox, width: int, height: int, padding: float = 0.03) -> tuple[int, int, int, int]:
    x1, y1, x2, y2 = box
    pad_x = (x2 - x1) * padding
    pad_y = (y2 - y1) * padding
    return (max(0, int((x1 - pad_x) * width)), max(0, int((y1 - pad_y) * height)),
            min(width, int(np.ceil((x2 + pad_x) * width))), min(height, int(np.ceil((y2 + pad_y) * height))))


def _encode_mask(mask: np.ndarray) -> dict:
    encoded = mask_util.encode(np.asfortranarray(mask.astype(np.uint8)))
    counts = encoded["counts"]
    return {"size": [int(encoded["size"][0]), int(encoded["size"][1])],
            "counts": counts.decode("ascii") if isinstance(counts, bytes) else counts}


def _polygons(mask: np.ndarray, width: int, height: int) -> list[list[float]]:
    contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    output: list[list[float]] = []
    for contour in contours:
        if cv2.contourArea(contour) < 4:
            continue
        points = cv2.approxPolyDP(contour, max(1.0, 0.003 * cv2.arcLength(contour, True)), True).reshape(-1, 2)
        if len(points) >= 3:
            output.append([round(float(value), 6) for point in points for value in (point[0] / width, point[1] / height)])
    return output


def _instances_to_original(masks: list[Sam3Mask], image_size: tuple[int, int], crop_box: tuple[int, int, int, int],
                           target_box: NormalizedBox) -> list[EncodedInstance]:
    width, height = image_size
    left, top, right, bottom = crop_box
    crop_width, crop_height = right - left, bottom - top
    candidates: list[tuple[np.ndarray, tuple[float, float, float, float], float]] = []
    for item in masks:
        resized = cv2.resize(item.mask.astype(np.uint8), (crop_width, crop_height), interpolation=cv2.INTER_NEAREST) > 0
        ys, xs = np.nonzero(resized)
        if len(xs) == 0:
            continue
        full_x1, full_y1 = left + int(xs.min()), top + int(ys.min())
        full_x2, full_y2 = left + int(xs.max()) + 1, top + int(ys.max()) + 1
        center_x, center_y = ((full_x1 + full_x2) / 2) / width, ((full_y1 + full_y2) / 2) / height
        if not (target_box[0] <= center_x <= target_box[2] and target_box[1] <= center_y <= target_box[3]):
            continue
        full_mask = np.zeros((height, width), dtype=bool)
        full_mask[top:bottom, left:right] = resized
        candidates.append((full_mask, (full_x1, full_y1, full_x2, full_y2), item.score))
    keep = suppress_overlapping([item[1] for item in candidates], [item[2] for item in candidates])
    output: list[EncodedInstance] = []
    for index in keep:
        mask, box, score = candidates[index]
        output.append(EncodedInstance(
            id=f"inst-{uuid.uuid4()}", score=round(float(score), 4),
            bbox=[round(box[0] / width, 6), round(box[1] / height, 6), round(box[2] / width, 6), round(box[3] / height, 6)],
            segmentation_rle=_encode_mask(mask), display_polygon=_polygons(mask, width, height)))
    return output


def _rectified_instances_to_original(
    masks: list[Sam3Mask], image_size: tuple[int, int], rectified: RectifiedPallet,
    target_box: NormalizedBox,
) -> list[EncodedInstance]:
    """Inverse-warp canonical masks so existing source-image overlays stay valid."""
    width, height = image_size
    inverse = np.linalg.inv(np.asarray(rectified.homography, dtype=np.float64))
    candidates: list[tuple[np.ndarray, tuple[float, float, float, float], float]] = []
    for item in masks:
        canonical = cv2.resize(
            item.mask.astype(np.uint8), (rectified.width, rectified.height),
            interpolation=cv2.INTER_NEAREST,
        )
        full_mask = cv2.warpPerspective(
            canonical, inverse, (width, height), flags=cv2.INTER_NEAREST,
            borderMode=cv2.BORDER_CONSTANT, borderValue=0,
        ) > 0
        ys, xs = np.nonzero(full_mask)
        if len(xs) == 0:
            continue
        box = (float(xs.min()), float(ys.min()), float(xs.max() + 1), float(ys.max() + 1))
        center_x = ((box[0] + box[2]) / 2) / width
        center_y = ((box[1] + box[3]) / 2) / height
        if not (target_box[0] <= center_x <= target_box[2] and target_box[1] <= center_y <= target_box[3]):
            continue
        candidates.append((full_mask, box, item.score))

    keep = suppress_overlapping([item[1] for item in candidates], [item[2] for item in candidates])
    return [
        EncodedInstance(
            id=f"inst-{uuid.uuid4()}", score=round(float(candidates[index][2]), 4),
            bbox=[round(candidates[index][1][0] / width, 6), round(candidates[index][1][1] / height, 6),
                  round(candidates[index][1][2] / width, 6), round(candidates[index][1][3] / height, 6)],
            segmentation_rle=_encode_mask(candidates[index][0]),
            display_polygon=_polygons(candidates[index][0], width, height),
        )
        for index in keep
    ]


def _geometry_metadata(location: PalletLocation) -> dict:
    return {
        "primaryFace": location.primary_face,
        "primaryFaceQuad": ([list(point) for point in location.primary_face_quad]
                            if location.primary_face_quad else None),
        "secondaryFacesVisible": list(location.secondary_faces_visible),
        "yawDegrees": location.yaw_degrees,
        "pitchDegrees": location.pitch_degrees,
        "faceVisibility": location.visibility,
        "geometryConfidence": location.geometry_confidence,
        "safeToRectify": location.safe_to_rectify,
    }


def _count_value(instances: list[EncodedInstance], prediction: CounterPrediction) -> int:
    return prediction.consensus_count if prediction.consensus_count is not None else len(instances)


class PalletVisionPipeline:
    def __init__(
        self, counter: PalletFaceCounter | None = None,
        cosmos: CosmosPalletLocator | None = None, rectification_mode: str | None = None,
    ) -> None:
        self.counter = counter or Sam3Counter()
        self.cosmos = cosmos or CosmosPalletLocator()
        mode = (rectification_mode or os.environ.get("PALLET_RECTIFICATION_MODE", "prefer")).lower()
        if mode not in {"off", "prefer", "shadow"}:
            raise ValueError("PALLET_RECTIFICATION_MODE must be off, prefer, or shadow")
        self.rectification_mode = mode
        self.version = f"{self.counter.version}+{self.cosmos.version}+rectification-v1"

    def warm_up_counter(self, image: Image.Image) -> None:
        self.counter.predict(image, "bag flap", [])

    async def locate(self, image: Image.Image, data_url: str | None = None) -> PalletLocation:
        return await self.cosmos.locate(data_url or image_to_data_url(image))

    def propose(self, image: Image.Image, target_box: NormalizedBox, prompt_boxes: list[NormalizedBox],
                text_prompt: str) -> list[EncodedInstance]:
        crop_box = _crop_box(target_box, image.width, image.height)
        crop = image.crop(crop_box)
        prompts = [prompt_in_crop(box, crop_box, image.width, image.height) for box in prompt_boxes]
        prediction = self.counter.predict(crop, text_prompt, prompts)
        return _instances_to_original(prediction.masks, image.size, crop_box, target_box)

    def _raw_pass(
        self, image: Image.Image, target_box: NormalizedBox,
    ) -> tuple[list[EncodedInstance], CounterPrediction, int]:
        started = time.perf_counter()
        crop_box = _crop_box(target_box, image.width, image.height)
        crop = image.crop(crop_box)
        prediction = self.counter.predict(crop, "bag flap", [])
        instances = _instances_to_original(prediction.masks, image.size, crop_box, target_box)
        return instances, prediction, round((time.perf_counter() - started) * 1000)

    def _rectified_pass(
        self, image: Image.Image, location: PalletLocation,
    ) -> tuple[list[EncodedInstance], CounterPrediction, RectifiedPallet, int]:
        if not location.box or not location.primary_face_quad:
            raise ValueError("Rectification requires a target box and primary-face quad")
        started = time.perf_counter()
        rectified = rectify_pallet_face(image, location.primary_face_quad)
        prediction = self.counter.predict(rectified.image, "bag flap", [])
        instances = _rectified_instances_to_original(prediction.masks, image.size, rectified, location.box)
        return instances, prediction, rectified, round((time.perf_counter() - started) * 1000)

    def reduce_instances(
        self, image: Image.Image, box: NormalizedBox, instances: list[EncodedInstance],
        *, prediction: CounterPrediction | None = None, counting_input: str = "raw",
        geometry: dict | None = None, rectification: dict | None = None,
        ab_comparison: dict | None = None,
    ) -> dict:
        pixel_boxes = [(item.bbox[0] * image.width, item.bbox[1] * image.height,
                        item.bbox[2] * image.width, item.bbox[3] * image.height) for item in instances]
        layers = estimate_layers(pixel_boxes)
        confidence = statistics.mean(item.score for item in instances) if instances else None
        model_count = prediction.consensus_count if prediction else None
        estimated_bags = model_count if model_count is not None else (len(instances) or None)
        return {"success": True, "layers": layers or None, "estimatedBags": estimated_bags,
                "confidence": round(confidence, 4) if confidence is not None else None,
                "needsReview": False, "reviewReason": None, "isPalletFace": True, "palletBox": list(box),
                "boxes": [item.bbox for item in instances], "masks": [item.segmentation_rle for item in instances],
                "displayPolygons": [item.display_polygon for item in instances], "maskCount": len(instances),
                "topLayerFull": True, "gaps": False, "damage": False,
                "rationale": (f"{self.counter.version} counted {len(instances)} visible bag flaps across "
                              f"{layers} row(s) from the {counting_input} pallet image."),
                "countingInput": counting_input,
                "counterHeads": {
                    "densityCount": prediction.density_count if prediction else None,
                    "bagCenters": [list(point) for point in (prediction.bag_centers if prediction else [])],
                    "countClass": prediction.count_class if prediction else None,
                    "consensusCount": prediction.consensus_count if prediction else None,
                    "confidence": prediction.confidence if prediction else None,
                },
                "geometry": geometry, "rectification": rectification,
                "abComparison": ab_comparison, "modelVersion": self.version}

    def count_located(self, image: Image.Image, location: PalletLocation) -> dict:
        """Count a resolved pallet, rectifying when safe and falling back to raw."""
        if not location.box:
            raise ValueError("Cannot count without a target pallet box")

        geometry = _geometry_metadata(location)
        rectification = {
            "mode": self.rectification_mode, "applied": False,
            "fallbackReason": None, "canonicalSize": None, "homography": None,
        }
        ab = {
            "enabled": self.rectification_mode == "shadow", "executed": False,
            "rawCount": None, "rectifiedCount": None, "countDelta": None,
            "rawLatencyMs": None, "rectifiedLatencyMs": None,
        }

        if (self.rectification_mode != "off" and location.safe_to_rectify
                and location.primary_face_quad):
            try:
                rectified_instances, prediction, rectified, rectified_ms = self._rectified_pass(image, location)
                rectification.update({
                    "applied": True, "canonicalSize": [rectified.width, rectified.height],
                    "homography": rectified.homography,
                })
                ab["rectifiedCount"] = _count_value(rectified_instances, prediction)
                ab["rectifiedLatencyMs"] = rectified_ms
                if self.rectification_mode == "shadow":
                    raw_instances, raw_prediction, raw_ms = self._raw_pass(image, location.box)
                    ab.update({
                        "executed": True,
                        "rawCount": _count_value(raw_instances, raw_prediction), "rawLatencyMs": raw_ms,
                        "countDelta": (_count_value(rectified_instances, prediction)
                                       - _count_value(raw_instances, raw_prediction)),
                    })
                return self.reduce_instances(
                    image, location.box, rectified_instances, prediction=prediction,
                    counting_input="rectified", geometry=geometry,
                    rectification=rectification, ab_comparison=ab,
                )
            except Exception as error:
                rectification["fallbackReason"] = f"rectification_failed:{type(error).__name__}"
        elif self.rectification_mode == "off":
            rectification["fallbackReason"] = "rectification_disabled"
        else:
            rectification["fallbackReason"] = location.reason or "geometry_marked_unsafe"

        instances, prediction, raw_ms = self._raw_pass(image, location.box)
        ab["rawCount"] = _count_value(instances, prediction)
        ab["rawLatencyMs"] = raw_ms
        return self.reduce_instances(
            image, location.box, instances, prediction=prediction, counting_input="raw",
            geometry=geometry, rectification=rectification, ab_comparison=ab,
        )

    def unresolved_result(self, location: PalletLocation) -> dict:
        return {"success": False, "layers": None, "estimatedBags": None,
                "confidence": location.confidence, "needsReview": True,
                "reviewReason": location.reason or "Intended pallet is ambiguous",
                "isPalletFace": False, "palletBox": list(location.box) if location.box else None,
                "boxes": [], "masks": [], "displayPolygons": [], "maskCount": 0,
                "topLayerFull": True, "gaps": False, "damage": False,
                "countingInput": None, "counterHeads": None,
                "geometry": _geometry_metadata(location),
                "rectification": None, "abComparison": None, "modelVersion": self.version}

    async def analyze(self, image: Image.Image, data_url: str | None = None) -> dict:
        location = await self.locate(image, data_url)
        if location.ambiguous or not location.box:
            return self.unresolved_result(location)
        return await asyncio.to_thread(self.count_located, image, location)
