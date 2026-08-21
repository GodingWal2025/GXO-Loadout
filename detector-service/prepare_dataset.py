"""Turn the console master export into the split layout expected by SAM 3."""

import argparse
import json
import shutil
from pathlib import Path


def prepare(source: Path, output: Path) -> None:
    coco_path = source / "annotations" / "master.coco.json"
    manifest_path = source / "manifest.json"
    if not coco_path.is_file() or not manifest_path.is_file():
        raise ValueError("source must contain manifest.json and annotations/master.coco.json")
    coco = json.loads(coco_path.read_text(encoding="utf-8"))
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    group_splits = {group["id"]: group["split"] for group in manifest.get("groups", [])}
    if not group_splits:
        raise ValueError("manifest contains no pallet groups")
    annotations_by_image: dict[int, list[dict]] = {}
    for annotation in coco.get("annotations", []):
        annotations_by_image.setdefault(annotation["image_id"], []).append(annotation)
    for split in ("train", "valid", "test"):
        split_dir = output / split
        split_dir.mkdir(parents=True, exist_ok=True)
        images, annotations = [], []
        for image in coco.get("images", []):
            group_id = image.get("pallet_group_id")
            declared_split = group_splits.get(group_id)
            if declared_split != image.get("split"):
                raise ValueError(f"image {image.get('file_name')} disagrees with manifest split")
            if declared_split != split:
                continue
            source_image = source / "images" / image["file_name"]
            if not source_image.is_file():
                raise ValueError(f"missing exported image: {source_image}")
            shutil.copy2(source_image, split_dir / image["file_name"])
            images.append(image)
            annotations.extend(annotations_by_image.get(image["id"], []))
        split_coco = {key: value for key, value in coco.items() if key not in {"images", "annotations"}}
        split_coco.update({"images": images, "annotations": annotations})
        (split_dir / "_annotations.coco.json").write_text(json.dumps(split_coco, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, help="extracted console dataset directory")
    parser.add_argument("--output", default="dataset")
    args = parser.parse_args()
    prepare(Path(args.source), Path(args.output))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, json.JSONDecodeError) as error:
        raise SystemExit(f"Dataset preparation failed: {error}") from error
