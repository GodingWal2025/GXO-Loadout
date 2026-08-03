"""Evaluate a trained checkpoint against a COCO test/validation split."""

import argparse
import json
import os
import re
import statistics
from collections import defaultdict
from pathlib import Path

from geometry import estimate_layers


def pallet_name(filename: str) -> str:
    stem = Path(filename).stem
    match = re.search(r"(?:pallet[_ -]?)?(\d+)", stem, re.IGNORECASE)
    return match.group(1) if match else stem


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-dir", default="dataset")
    parser.add_argument("--weights", required=True)
    parser.add_argument("--model-size", default="small")
    parser.add_argument("--output", default="eval-results.json")
    parser.add_argument("--min-exact-layer-accuracy", type=float, default=0.0)
    parser.add_argument("--min-within-one-layer-accuracy", type=float, default=0.0)
    parser.add_argument("--max-visible-bag-mae", type=float, default=None)
    args = parser.parse_args()

    os.environ.update({
        "DETECTOR_BACKEND": "rfdetr",
        "RFDETR_MODEL_SIZE": args.model_size,
        "RFDETR_WEIGHTS": args.weights,
        "RFDETR_CLASS_NAMES": "bag_flap",
        "RFDETR_BAG_CLASSES": "bag_flap",
    })
    from app import MODEL_VERSION, analyze_image, load_image

    root = Path(args.dataset_dir)
    split = root / "test"
    if not (split / "_annotations.coco.json").exists():
        split = root / "valid"
    data = json.loads((split / "_annotations.coco.json").read_text(encoding="utf-8"))

    annotations = defaultdict(list)
    for annotation in data.get("annotations", []):
        x, y, width, height = annotation["bbox"]
        annotations[annotation["image_id"]].append((x, y, x + width, y + height))

    results = []
    for image_info in data.get("images", []):
        filename = image_info["file_name"]
        expected_boxes = annotations[image_info["id"]]
        expected_layers = estimate_layers(expected_boxes)
        image = load_image((split / filename).read_bytes())
        prediction = analyze_image(image)
        results.append({
            "file": filename,
            "pallet": pallet_name(filename),
            "layers": prediction.get("layers"),
            "visibleBags": prediction.get("estimatedBags"),
            "expected": expected_layers,
            "expectedVisibleBags": len(expected_boxes),
            "confidence": prediction.get("confidence"),
            "isPalletFace": True,
        })

    layer_errors = [abs(row["layers"] - row["expected"]) for row in results if row["layers"] is not None]
    count_errors = [abs(row["visibleBags"] - row["expectedVisibleBags"]) for row in results if row["visibleBags"] is not None]
    per_pallet = defaultdict(list)
    for row in results:
        if row["layers"] is not None:
            per_pallet[row["pallet"]].append(row["layers"])
    output = {
        "model": MODEL_VERSION,
        "samples": 1,
        "split": split.name,
        "summary": {
            "images": len(results),
            "exactLayerAccuracy": round(sum(error == 0 for error in layer_errors) / len(results), 4) if results else 0,
            "withinOneLayerAccuracy": round(sum(error <= 1 for error in layer_errors) / len(results), 4) if results else 0,
            "meanAbsoluteLayerError": round(statistics.mean(layer_errors), 3) if layer_errors else None,
            "meanAbsoluteVisibleBagError": round(statistics.mean(count_errors), 3) if count_errors else None,
        },
        "results": results,
        "perPallet": dict(per_pallet),
    }
    Path(args.output).write_text(json.dumps(output, indent=2), encoding="utf-8")
    print(json.dumps(output["summary"], indent=2))

    failures = []
    summary = output["summary"]
    if summary["exactLayerAccuracy"] < args.min_exact_layer_accuracy:
        failures.append("exact layer accuracy is below the release threshold")
    if summary["withinOneLayerAccuracy"] < args.min_within_one_layer_accuracy:
        failures.append("within-one-layer accuracy is below the release threshold")
    if args.max_visible_bag_mae is not None and (
        summary["meanAbsoluteVisibleBagError"] is None
        or summary["meanAbsoluteVisibleBagError"] > args.max_visible_bag_mae
    ):
        failures.append("visible bag mean absolute error is above the release threshold")
    if failures:
        raise SystemExit("Quality gate failed: " + "; ".join(failures))


if __name__ == "__main__":
    main()
