import json

import pytest

from validate_dataset import validate_dataset


def write_split(root, split, group, byte):
    folder = root / split
    folder.mkdir()
    name = f"{split}.jpg"
    (folder / name).write_bytes(bytes([byte]))
    data = {
        "categories": [{"id": 1, "name": "bag flap"}],
        "images": [{"id": byte, "file_name": name, "pallet_group_id": group,
                    "target_pallet_box": [0.1, 0.1, 0.9, 0.9]}],
        "annotations": [{"id": byte, "image_id": byte, "category_id": 1,
                         "bbox": [1, 1, 2, 2], "segmentation": {"size": [4, 4], "counts": "abc"}}],
    }
    (folder / "_annotations.coco.json").write_text(json.dumps(data), encoding="utf-8")


def test_accepts_unique_pallet_groups_with_rle_masks(tmp_path):
    for index, split in enumerate(("train", "valid", "test"), 1):
        write_split(tmp_path, split, f"pallet-{index}", index)
    totals = validate_dataset(tmp_path, require_test=True, minimum_images=1)
    assert totals["test"] == (1, 1)


def test_rejects_pallet_group_leakage(tmp_path):
    write_split(tmp_path, "train", "same-pallet", 1)
    write_split(tmp_path, "valid", "same-pallet", 2)
    write_split(tmp_path, "test", "third-pallet", 3)
    with pytest.raises(ValueError, match="leaks across"):
        validate_dataset(tmp_path, require_test=True, minimum_images=1)
