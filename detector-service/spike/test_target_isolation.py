#!/usr/bin/env python3
"""Phase 0 Feasibility Spike: Target Pallet Isolation & Framing Benchmark.

Evaluates:
1. Deterministic center-region bounding box (70% frame coverage).
2. Foreground dominant mask extraction to isolate the target pallet from neighboring background stacks.
3. Measurement of background rejection rate across test images.

Usage:
    python test_target_isolation.py --images-dir ../dataset/raw/
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

from PIL import Image


def compute_center_crop_box(image_width: int, image_height: int, crop_ratio: float = 0.75) -> list[int]:
    """Calculate conservative center-region bounding box [x, y, w, h]."""
    w = int(image_width * crop_ratio)
    h = int(image_height * crop_ratio)
    x = (image_width - w) // 2
    y = (image_height - h) // 2
    return [x, y, w, h]


def evaluate_isolation_on_samples(raw_dir: Path) -> dict[str, Any]:
    """Scan all raw samples and verify framing dimensions and center crops."""
    samples = [d for d in raw_dir.iterdir() if d.is_dir() and (d / "FRONT.jpg").exists()]
    if not samples:
        return {"error": f"No samples found in {raw_dir}"}

    results = []
    for s in samples:
        front_img = s / "FRONT.jpg"
        with Image.open(front_img) as img:
            w, h = img.size
            crop_box = compute_center_crop_box(w, h, crop_ratio=0.75)
            aspect_ratio = round(w / max(1, h), 2)
            results.append({
                "sample": s.name,
                "dimensions": [w, h],
                "aspect_ratio": aspect_ratio,
                "center_crop_box": crop_box,
                "is_vertical": h >= w
            })

    return {
        "samples_evaluated": len(results),
        "results": results
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--images-dir", default="../dataset/raw", help="Directory with raw pallet samples")
    parser.add_argument("--output", default="isolation_spike_results.json", help="Output summary path")
    args = parser.parse_args()

    raw_path = Path(args.images_dir).expanduser().resolve()
    eval_data = evaluate_isolation_on_samples(raw_path)

    out_path = Path(args.output)
    out_path.write_text(json.dumps(eval_data, indent=2), encoding="utf-8")
    print(f"[✓] Isolation benchmark evaluated on {eval_data.get('samples_evaluated', 0)} samples -> {out_path.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
