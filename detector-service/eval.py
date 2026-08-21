"""Evaluate SAM 3 bag-flap segmentation on the pallet-isolated test split."""

import argparse
import json
import os
import statistics
from collections import defaultdict
from pathlib import Path

from geometry import box_iou, estimate_layers


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-dir", default="dataset")
    parser.add_argument("--weights", required=True)
    parser.add_argument("--output", default="eval-results.json")
    parser.add_argument("--min-exact-layer-accuracy", type=float, default=0.0)
    parser.add_argument("--min-within-one-layer-accuracy", type=float, default=0.0)
    parser.add_argument("--max-visible-bag-mae", type=float)
    parser.add_argument("--min-box-iou", type=float, default=0.0)
    args = parser.parse_args()
    os.environ["SAM3_CHECKPOINT"] = str(Path(args.weights).resolve())

    from pipeline import PalletVisionPipeline, load_image
    pipeline = PalletVisionPipeline()
    root = Path(args.dataset_dir)
    split = root / "test"
    data = json.loads((split / "_annotations.coco.json").read_text(encoding="utf-8"))
    expected_by_image: dict[int, list[tuple[float, float, float, float]]] = defaultdict(list)
    for annotation in data.get("annotations", []):
        x, y, width, height = annotation["bbox"]
        expected_by_image[annotation["image_id"]].append((x, y, x + width, y + height))

    results = []
    for image_info in data.get("images", []):
        image = load_image((split / image_info["file_name"]).read_bytes())
        target = image_info.get("target_pallet_box")
        if not target:
            raise ValueError(f"{image_info['file_name']} is missing target_pallet_box")
        instances = pipeline.propose(image, tuple(target), [], "bag flap")
        predicted = [(box[0] * image.width, box[1] * image.height, box[2] * image.width, box[3] * image.height)
                     for box in (item.bbox for item in instances)]
        expected = expected_by_image[image_info["id"]]
        best_ious = [max((box_iou(box, prediction) for prediction in predicted), default=0.0) for box in expected]
        results.append({"file": image_info["file_name"], "palletGroup": image_info["pallet_group_id"],
                        "layers": estimate_layers(predicted), "expectedLayers": estimate_layers(expected),
                        "visibleBags": len(predicted), "expectedVisibleBags": len(expected),
                        "meanBestBoxIou": statistics.mean(best_ious) if best_ious else (1.0 if not predicted else 0.0)})

    layer_errors = [abs(row["layers"] - row["expectedLayers"]) for row in results]
    count_errors = [abs(row["visibleBags"] - row["expectedVisibleBags"]) for row in results]
    summary = {
        "images": len(results),
        "exactLayerAccuracy": round(sum(error == 0 for error in layer_errors) / len(results), 4) if results else 0,
        "withinOneLayerAccuracy": round(sum(error <= 1 for error in layer_errors) / len(results), 4) if results else 0,
        "meanAbsoluteLayerError": round(statistics.mean(layer_errors), 3) if layer_errors else None,
        "meanAbsoluteVisibleBagError": round(statistics.mean(count_errors), 3) if count_errors else None,
        "meanBestBoxIou": round(statistics.mean(row["meanBestBoxIou"] for row in results), 4) if results else 0,
    }
    Path(args.output).write_text(json.dumps({"model": pipeline.version, "split": "test", "summary": summary,
                                            "results": results}, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))
    failures = []
    if summary["exactLayerAccuracy"] < args.min_exact_layer_accuracy: failures.append("exact layer accuracy")
    if summary["withinOneLayerAccuracy"] < args.min_within_one_layer_accuracy: failures.append("within-one layer accuracy")
    if args.max_visible_bag_mae is not None and summary["meanAbsoluteVisibleBagError"] > args.max_visible_bag_mae:
        failures.append("visible-bag MAE")
    if summary["meanBestBoxIou"] < args.min_box_iou: failures.append("box IoU")
    if failures:
        raise SystemExit("Quality gate failed: " + ", ".join(failures))


if __name__ == "__main__":
    main()
