"""Geometry helpers for pallet localization and perspective rectification."""

from __future__ import annotations

import statistics
from dataclasses import dataclass

import cv2
import numpy as np
from PIL import Image


Box = tuple[float, float, float, float]
Point = tuple[float, float]
Quad = tuple[Point, Point, Point, Point]


@dataclass(frozen=True)
class RectifiedPallet:
    image: Image.Image
    source_quad: Quad
    width: int
    height: int
    homography: list[list[float]]


def prompt_in_crop(box: Box, crop: tuple[int, int, int, int], width: int, height: int) -> Box:
    """Map normalized original-image xyxy to normalized crop cx/cy/width/height."""
    left, top, right, bottom = crop
    crop_width, crop_height = right - left, bottom - top
    x1, y1, x2, y2 = box
    cx1 = max(0.0, min(1.0, (x1 * width - left) / crop_width))
    cy1 = max(0.0, min(1.0, (y1 * height - top) / crop_height))
    cx2 = max(0.0, min(1.0, (x2 * width - left) / crop_width))
    cy2 = max(0.0, min(1.0, (y2 * height - top) / crop_height))
    return ((cx1 + cx2) / 2, (cy1 + cy2) / 2, cx2 - cx1, cy2 - cy1)


def estimate_layers(boxes: list[Box]) -> int:
    """Cluster bag centers into horizontal rows using median bag height."""
    if not boxes:
        return 0

    centers = sorted(((y1 + y2) / 2.0, abs(y2 - y1)) for _, y1, _, y2 in boxes)
    threshold = max(1.0, 0.55 * (statistics.median(h for _, h in centers) or 1.0))
    rows: list[list[float]] = []

    for center_y, _ in centers:
        nearest = min(
            range(len(rows)),
            key=lambda index: abs(center_y - statistics.median(rows[index])),
            default=None,
        )
        if nearest is None or abs(center_y - statistics.median(rows[nearest])) > threshold:
            rows.append([center_y])
        else:
            rows[nearest].append(center_y)

    return len(rows)


def normalize_boxes(boxes: list[Box], width: int, height: int) -> list[list[float]]:
    """Convert pixel xyxy boxes to clipped 0..1 coordinates for browser overlays."""
    if width <= 0 or height <= 0:
        return []
    return [
        [
            round(max(0.0, min(1.0, x1 / width)), 5),
            round(max(0.0, min(1.0, y1 / height)), 5),
            round(max(0.0, min(1.0, x2 / width)), 5),
            round(max(0.0, min(1.0, y2 / height)), 5),
        ]
        for x1, y1, x2, y2 in boxes
    ]


def box_iou(left: Box, right: Box) -> float:
    """Intersection over union for pixel xyxy boxes."""
    x1 = max(left[0], right[0])
    y1 = max(left[1], right[1])
    x2 = min(left[2], right[2])
    y2 = min(left[3], right[3])
    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    left_area = max(0.0, left[2] - left[0]) * max(0.0, left[3] - left[1])
    right_area = max(0.0, right[2] - right[0]) * max(0.0, right[3] - right[1])
    union = left_area + right_area - intersection
    return intersection / union if union > 0 else 0.0


def suppress_overlapping(boxes: list[Box], scores: list[float], threshold: float = 0.75) -> list[int]:
    """Return indices kept by score-ordered non-maximum suppression."""
    kept: list[int] = []
    for index in sorted(range(len(boxes)), key=lambda item: scores[item], reverse=True):
        if all(box_iou(boxes[index], boxes[other]) < threshold for other in kept):
            kept.append(index)
    return kept


def validate_quad(value: object) -> Quad | None:
    """Validate a four-corner normalized polygon with non-trivial area."""
    if not isinstance(value, list) or len(value) != 4:
        return None
    points: list[Point] = []
    for item in value:
        if not isinstance(item, (list, tuple)) or len(item) != 2:
            return None
        try:
            x, y = float(item[0]), float(item[1])
        except (TypeError, ValueError):
            return None
        if not (0.0 <= x <= 1.0 and 0.0 <= y <= 1.0):
            return None
        points.append((x, y))

    area = sum(
        points[index][0] * points[(index + 1) % 4][1]
        - points[(index + 1) % 4][0] * points[index][1]
        for index in range(4)
    )
    if abs(area) < 0.002:
        return None
    return tuple(points)  # type: ignore[return-value]


def order_quad(points: Quad, width: int, height: int) -> np.ndarray:
    """Order normalized quad points as TL, TR, BR, BL in pixel coordinates."""
    pts = np.asarray([(x * width, y * height) for x, y in points], dtype=np.float32)
    sums = pts.sum(axis=1)
    diffs = np.diff(pts, axis=1).reshape(-1)
    ordered = np.zeros((4, 2), dtype=np.float32)
    ordered[0] = pts[np.argmin(sums)]
    ordered[2] = pts[np.argmax(sums)]
    ordered[1] = pts[np.argmin(diffs)]
    ordered[3] = pts[np.argmax(diffs)]
    return ordered


def estimate_quad_skew(points: Quad, width: int, height: int) -> float:
    """Return a simple 0..1 perspective-skew score for quality gating."""
    tl, tr, br, bl = order_quad(points, width, height)
    top = float(np.linalg.norm(tr - tl))
    bottom = float(np.linalg.norm(br - bl))
    left = float(np.linalg.norm(bl - tl))
    right = float(np.linalg.norm(br - tr))
    horizontal = abs(top - bottom) / max(top, bottom, 1.0)
    vertical = abs(left - right) / max(left, right, 1.0)
    return max(horizontal, vertical)


def rectify_pallet_face(
    image: Image.Image,
    face_quad: Quad,
    *,
    min_dimension: int = 384,
    max_dimension: int = 1536,
) -> RectifiedPallet:
    """Warp an angled pallet face into a canonical front-facing rectangle."""
    src = order_quad(face_quad, image.width, image.height)
    tl, tr, br, bl = src
    target_width = int(round(max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl))))
    target_height = int(round(max(np.linalg.norm(bl - tl), np.linalg.norm(br - tr))))
    if target_width < 2 or target_height < 2:
        raise ValueError("Pallet face is too small to rectify")

    scale_up = max(min_dimension / target_width, min_dimension / target_height, 1.0)
    target_width = int(round(target_width * scale_up))
    target_height = int(round(target_height * scale_up))
    scale_down = min(max_dimension / target_width, max_dimension / target_height, 1.0)
    target_width = max(2, int(round(target_width * scale_down)))
    target_height = max(2, int(round(target_height * scale_down)))

    dst = np.asarray(
        [[0, 0], [target_width - 1, 0],
         [target_width - 1, target_height - 1], [0, target_height - 1]],
        dtype=np.float32,
    )
    matrix = cv2.getPerspectiveTransform(src, dst)
    warped = cv2.warpPerspective(
        np.asarray(image), matrix, (target_width, target_height),
        flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE,
    )
    return RectifiedPallet(
        image=Image.fromarray(warped), source_quad=face_quad,
        width=target_width, height=target_height, homography=matrix.tolist(),
    )
