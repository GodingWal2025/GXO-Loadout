from __future__ import annotations

import base64
import io
import os
import statistics
import uuid
from dataclasses import dataclass

import cv2
import numpy as np
from PIL import Image, ImageOps
from pycocotools import mask as mask_util

from cosmos_client import CosmosPalletLocator, PalletLocation
from geometry import estimate_layers, prompt_in_crop, suppress_overlapping
from sam3_model import Sam3BagFlapModel, Sam3Mask
from schemas import NormalizedBox


@dataclass
class EncodedInstance:
    id: str
    score: float
    bbox: list[float]
    segmentation_rle: dict
    display_polygon: list[list[float]]


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


class PalletVisionPipeline:
    def __init__(self) -> None:
        self.sam3 = Sam3BagFlapModel()
        self.cosmos = CosmosPalletLocator()
        self.version = f"{self.sam3.version}+{self.cosmos.version}"

    async def locate(self, image: Image.Image, data_url: str | None = None) -> PalletLocation:
        return await self.cosmos.locate(data_url or image_to_data_url(image))

    def propose(self, image: Image.Image, target_box: NormalizedBox, prompt_boxes: list[NormalizedBox],
                text_prompt: str) -> list[EncodedInstance]:
        crop_box = _crop_box(target_box, image.width, image.height)
        crop = image.crop(crop_box)
        prompts = [prompt_in_crop(box, crop_box, image.width, image.height) for box in prompt_boxes]
        return _instances_to_original(self.sam3.segment(crop, text_prompt, prompts), image.size, crop_box, target_box)

    def reduce_instances(self, image: Image.Image, box: NormalizedBox, instances: list[EncodedInstance]) -> dict:
        pixel_boxes = [(item.bbox[0] * image.width, item.bbox[1] * image.height,
                        item.bbox[2] * image.width, item.bbox[3] * image.height) for item in instances]
        layers = estimate_layers(pixel_boxes)
        confidence = statistics.mean(item.score for item in instances) if instances else None
        return {"success": True, "layers": layers or None, "estimatedBags": len(instances) or None,
                "confidence": round(confidence, 4) if confidence is not None else None,
                "needsReview": False, "reviewReason": None, "isPalletFace": True, "palletBox": list(box),
                "boxes": [item.bbox for item in instances], "masks": [item.segmentation_rle for item in instances],
                "displayPolygons": [item.display_polygon for item in instances], "maskCount": len(instances),
                "topLayerFull": True, "gaps": False, "damage": False,
                "rationale": f"SAM 3 segmented {len(instances)} visible bag flaps across {layers} row(s).",
                "modelVersion": self.version}

    async def analyze(self, image: Image.Image, data_url: str | None = None) -> dict:
        location = await self.locate(image, data_url)
        if location.ambiguous or not location.box:
            return {"success": False, "layers": None, "estimatedBags": None, "confidence": location.confidence,
                    "needsReview": True, "reviewReason": location.reason or "Intended pallet is ambiguous",
                    "isPalletFace": False, "palletBox": list(location.box) if location.box else None,
                    "boxes": [], "masks": [], "displayPolygons": [], "maskCount": 0,
                    "topLayerFull": True, "gaps": False, "damage": False, "modelVersion": self.version}
        return self.reduce_instances(image, location.box, self.propose(image, location.box, [], "bag flap"))
