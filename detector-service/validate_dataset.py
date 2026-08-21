"""Validate the pallet-isolated SAM 3 COCO dataset before training."""

import argparse
import hashlib
import json
from pathlib import Path

VALID_CATEGORY_NAMES = {"bag flap", "bag_flap"}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_split(split_dir: Path, required: bool, minimum_images: int) -> tuple[int, int, set[str]]:
    annotation_path = split_dir / "_annotations.coco.json"
    if not annotation_path.exists():
        if required:
            raise ValueError(f"Missing {annotation_path}")
        return (0, 0, set())
    data = json.loads(annotation_path.read_text(encoding="utf-8"))
    categories = [str(item.get("name", "")).strip().lower() for item in data.get("categories", [])]
    if len(categories) != 1 or categories[0] not in VALID_CATEGORY_NAMES:
        raise ValueError(f"{annotation_path}: expected exactly one 'bag flap' category; got {categories}")
    images, annotations = data.get("images", []), data.get("annotations", [])
    if len(images) < minimum_images:
        raise ValueError(f"{annotation_path}: has {len(images)} images; at least {minimum_images} required")
    image_ids = {item["id"] for item in images}
    groups = {str(item.get("pallet_group_id", "")).strip() for item in images}
    if "" in groups:
        raise ValueError(f"{annotation_path}: every image needs pallet_group_id")
    for item in images:
        target = item.get("target_pallet_box", [])
        if len(target) != 4 or not (0 <= target[0] < target[2] <= 1 and 0 <= target[1] < target[3] <= 1):
            raise ValueError(f"{annotation_path}: image {item.get('file_name')} needs a normalized target_pallet_box")
    if required and not annotations:
        raise ValueError(f"{annotation_path}: needs at least one positive mask (negative images may also be included)")
    for annotation in annotations:
        if annotation.get("image_id") not in image_ids:
            raise ValueError(f"{annotation_path}: annotation references an unknown image")
        segmentation = annotation.get("segmentation")
        if not isinstance(segmentation, dict) or not segmentation.get("counts") or not segmentation.get("size"):
            raise ValueError(f"{annotation_path}: annotation {annotation.get('id')} needs a COCO RLE mask")
        bbox = annotation.get("bbox", [])
        if len(bbox) != 4 or bbox[2] <= 0 or bbox[3] <= 0:
            raise ValueError(f"{annotation_path}: annotation {annotation.get('id')} has an invalid bbox")
    hashes: set[str] = set()
    for item in images:
        image_path = split_dir / item["file_name"]
        if not image_path.is_file():
            raise ValueError(f"{annotation_path}: missing image {item['file_name']}")
        digest = _sha256(image_path)
        if digest in hashes:
            raise ValueError(f"{annotation_path}: duplicate image bytes detected for {item['file_name']}")
        hashes.add(digest)
    return len(images), len(annotations), groups


def validate_dataset(root: Path, require_test: bool, minimum_images: int) -> dict[str, tuple[int, int]]:
    totals: dict[str, tuple[int, int]] = {}
    seen_groups: dict[str, str] = {}
    seen_hashes: dict[str, str] = {}
    for split, required in (("train", True), ("valid", True), ("test", require_test)):
        images, masks, groups = validate_split(root / split, required, minimum_images)
        totals[split] = (images, masks)
        for group in groups:
            prior = seen_groups.get(group)
            if prior:
                raise ValueError(f"pallet group {group!r} leaks across {prior} and {split}")
            seen_groups[group] = split
        split_dir = root / split
        if split_dir.exists():
            for image_path in split_dir.iterdir():
                if image_path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
                    continue
                digest = _sha256(image_path)
                prior = seen_hashes.get(digest)
                if prior:
                    raise ValueError(f"duplicate image bytes appear in both {prior} and {split}: {image_path.name}")
                seen_hashes[digest] = split
    return totals


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-dir", default="dataset")
    parser.add_argument("--require-test", action="store_true")
    parser.add_argument("--minimum-images", type=int, default=1)
    args = parser.parse_args()
    totals = validate_dataset(Path(args.dataset_dir), args.require_test, args.minimum_images)
    for split, (images, masks) in totals.items():
        if images:
            print(f"{split}: {images} images, {masks} bag-flap masks")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, json.JSONDecodeError) as error:
        raise SystemExit(f"Dataset validation failed: {error}") from error
