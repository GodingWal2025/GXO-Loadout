"""SAM Segmenter Service (GPU 1)

Runs Meta SAM (Segment Anything) on GPU 1 to segment individual bag flap
masks within VLM-guided layer slices.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image
import torch
from sam2.build_sam import build_sam2
from sam2.sam2_image_predictor import SAM2ImagePredictor


class SAMDetectorService:
    def __init__(
        self,
        checkpoint_path: str = "/workspace/models/sam/sam2_hiera_large.pt",
        model_cfg: str = "sam2_hiera_l.yaml",
        device: str = "cuda:1"
    ) -> None:
        self.device = device
        print(f"[*] Initializing SAM 2 on {device} (checkpoint: {checkpoint_path})...")
        
        # Fallback to local default if container path differs
        ckpt = Path(checkpoint_path)
        if not ckpt.exists():
            ckpt = Path("weights/sam2_hiera_large.pt")
            
        self.predictor = SAM2ImagePredictor(
            build_sam2(model_cfg, str(ckpt), device=device)
        )
        print(f"[✓] SAM 2 loaded into VRAM on {device}!")

    def segment_flaps_in_layer_bands(
        self,
        image: Image.Image,
        layer_bounds: list[dict[str, Any]] | None = None
    ) -> list[dict[str, Any]]:
        """Segment bag flaps within specific layer horizontal bands."""
        img_rgb = image.convert("RGB")
        w, h = img_rgb.size
        img_np = np.array(img_rgb)
        
        self.predictor.set_image(img_np)
        
        # If layer bounds not provided, use default 10-layer grid bands
        if not layer_bounds:
            layer_bounds = []
            for i in range(10):
                ymin = 0.15 + (i * 0.07)
                ymax = ymin + 0.065
                layer_bounds.append({"layer": i + 1, "ymin": ymin, "ymax": ymax})

        detected_flaps = []
        
        for lb in layer_bounds:
            layer_idx = lb.get("layer", 1)
            ymin_px = int(lb.get("ymin", 0.0) * h)
            ymax_px = int(lb.get("ymax", 1.0) * h)
            mid_y = (ymin_px + ymax_px) // 2
            
            # Sample 4 probe points horizontally along this layer band
            xs = np.linspace(int(w * 0.20), int(w * 0.80), 4, dtype=int)
            for x in xs:
                point_coords = np.array([[x, mid_y]])
                point_labels = np.array([1])
                masks, scores, _ = self.predictor.predict(
                    point_coords=point_coords,
                    point_labels=point_labels,
                    multimask_output=True
                )
                best_idx = np.argmax(scores)
                score = float(scores[best_idx])
                
                if score > 0.80:
                    mask = masks[best_idx]
                    y_indices, x_indices = np.where(mask)
                    if len(x_indices) > 0:
                        box = [
                            int(x_indices.min()),
                            int(y_indices.min()),
                            int(x_indices.max() - x_indices.min()),
                            int(y_indices.max() - y_indices.min())
                        ]
                        detected_flaps.append({
                            "layer": layer_idx,
                            "box": box,
                            "confidence": round(score, 4),
                            "centroid": [int(x_indices.mean()), int(y_indices.mean())]
                        })

        return detected_flaps
