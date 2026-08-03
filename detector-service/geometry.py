"""Geometry helpers that do not require loading a vision model."""

import statistics


Box = tuple[float, float, float, float]


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
