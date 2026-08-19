"""Dataset builder for Fine-Tuning NVIDIA Cosmos-Reason2-8B on Warehouse Seed Bag Pallets.

Parses the raw multi-view images (FRONT, RIGHT, BACK, LEFT) along with the ground-truth
layer and bag counts to generate supervised fine-tuning (SFT) conversation pairs.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


def build_training_dataset(
    raw_dir: Path = Path("dataset/raw"),
    output_json: Path = Path("dataset/cosmos_sft_training.json")
) -> list[dict[str, Any]]:
    dataset = []
    
    if not raw_dir.exists():
        print(f"[!] Raw dataset directory not found: {raw_dir}")
        return []

    pallet_dirs = [d for d in raw_dir.iterdir() if d.is_dir() and (d / "FRONT.jpg").exists()]
    print(f"[*] Found {len(pallet_dirs)} pallet directories in {raw_dir}...")

    for p in pallet_dirs:
        # Check required faces
        faces = ["FRONT.jpg", "RIGHT.jpg", "BACK.jpg", "LEFT.jpg"]
        if not all((p / f).exists() for f in faces):
            continue

        # Load metadata if exists
        meta_file = p / "meta.json"
        meta = {}
        if meta_file.exists():
            try:
                meta = json.loads(meta_file.read_text(encoding="utf-8"))
            except Exception:
                pass

        total_bags = meta.get("actual_total") or meta.get("total_bags") or 60
        bags_per_layer = meta.get("bags_per_layer", 6)
        full_layers = meta.get("full_layers") or (total_bags // bags_per_layer)
        partial_top = meta.get("partial_top_count") or (total_bags % bags_per_layer)
        has_partial = partial_top > 0

        # Build target response
        target_json = {
            "reasoning": (
                f"Inspecting 4 pallet faces. Layer 1 starts on wooden pallet base. "
                f"Identified {full_layers} full horizontal layers with {bags_per_layer} bags per layer. "
                f"{'Top layer has partial ' + str(partial_top) + ' loose bags.' if has_partial else 'Top layer is full and flat.'} "
                f"Total calculated: ({full_layers} * {bags_per_layer}) + {partial_top} = {total_bags} bags."
            ),
            "layerCountByFace": {
                "front": full_layers + (1 if has_partial else 0),
                "right": full_layers + (1 if has_partial else 0),
                "back": full_layers + (1 if has_partial else 0),
                "left": full_layers + (1 if has_partial else 0)
            },
            "consensusLayers": full_layers + (1 if has_partial else 0),
            "estimatedBagsPerLayer": bags_per_layer,
            "partialTopDetected": has_partial,
            "partialTopCountEstimate": partial_top,
            "irregularStack": meta.get("quality") == "bad",
            "structuralTotalEstimate": total_bags
        }

        entry = {
            "id": p.name,
            "images": [
                str(p / "FRONT.jpg"),
                str(p / "RIGHT.jpg"),
                str(p / "BACK.jpg"),
                str(p / "LEFT.jpg")
            ],
            "conversations": [
                {
                    "from": "human",
                    "value": (
                        "You are an expert industrial computer vision inspector counting stacked seed bags on a warehouse pallet.\n"
                        "You are provided with 4 ordered side view photos of the pallet:\n"
                        "Image 1: FRONT face\n"
                        "Image 2: RIGHT face\n"
                        "Image 3: BACK face\n"
                        "Image 4: LEFT face\n\n"
                        "Count layers sequentially from the bottom pallet upward. "
                        "Determine layer count per face, bags per layer, whether top course is partial, and calculate total bag count."
                    )
                },
                {
                    "from": "gpt",
                    "value": json.dumps(target_json, indent=2)
                }
            ]
        }
        dataset.append(entry)

    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(dataset, indent=2), encoding="utf-8")
    print(f"[✓] Created SFT dataset with {len(dataset)} examples -> {output_json}")
    return dataset


if __name__ == "__main__":
    build_training_dataset()
