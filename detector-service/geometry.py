"""Geometry helpers that do not require loading a vision model."""

import statistics


Box = tuple[float, float, float, float]


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
