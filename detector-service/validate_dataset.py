"""Validate the COCO dataset contract before an expensive training run."""

import argparse
import json
from pathlib import Path


def validate_split(split_dir: Path, required: bool, minimum_images: int) -> tuple[int, int]:
    annotation_path = split_dir / "_annotations.coco.json"
    if not annotation_path.exists():
        if required:
            raise ValueError(f"Missing {annotation_path}")
        return (0, 0)

    data = json.loads(annotation_path.read_text(encoding="utf-8"))
    categories = [str(category.get("name", "")).strip() for category in data.get("categories", [])]
    if categories != ["bag_flap"]:
        raise ValueError(
            f"{annotation_path}: expected exactly one category named 'bag_flap'; got {categories}"
        )

    images = data.get("images", [])
    annotations = data.get("annotations", [])
    if not images:
        raise ValueError(f"{annotation_path}: contains no images")
    if len(images) < minimum_images:
        raise ValueError(
            f"{annotation_path}: has {len(images)} images; at least {minimum_images} are required"
        )
    if not annotations:
        raise ValueError(f"{annotation_path}: contains no bounding boxes")

    missing = [item["file_name"] for item in images if not (split_dir / item["file_name"]).exists()]
    if missing:
        preview = ", ".join(missing[:5])
        raise ValueError(f"{annotation_path}: {len(missing)} referenced image(s) are missing: {preview}")
    return (len(images), len(annotations))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-dir", default="dataset")
    parser.add_argument("--require-test", action="store_true")
    parser.add_argument("--minimum-images", type=int, default=1)
    args = parser.parse_args()
    root = Path(args.dataset_dir)

    totals = {}
    for split, required in (("train", True), ("valid", True), ("test", args.require_test)):
        totals[split] = validate_split(root / split, required, args.minimum_images)

    if totals["test"] == (0, 0):
        print("Warning: no test split; evaluation will use valid/. Add a pallet-isolated test split before release.")
    for split, (images, boxes) in totals.items():
        if images:
            print(f"{split}: {images} images, {boxes} bag_flap boxes")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, json.JSONDecodeError) as error:
        raise SystemExit(f"Dataset validation failed: {error}") from error
