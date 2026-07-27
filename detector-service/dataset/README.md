# Pallet-bag training dataset (COCO format)

RF-DETR trains on **COCO-format** data. Put your dataset here (or anywhere and pass
`--dataset-dir`). Layout RF-DETR expects:

```
dataset/
  train/
    _annotations.coco.json     # COCO annotations for the train split
    IMG_0001.jpg
    IMG_0002.jpg
    ...
  valid/
    _annotations.coco.json
    ...
  test/                        # optional
    _annotations.coco.json
    ...
```

## Getting there from your photos

1. **Collect** pallet-face photos from the verifier confirm-loop (the ones inspectors
   already confirm). Aim for 200–500 across the bag types, lighting, and stack heights
   you actually see. Variety matters more than raw count.
2. **Label** in [Roboflow](https://roboflow.com) or [CVAT]. Draw one box per visible
   bag, class `bag`. Optionally add `gap` (a hole/missing bag) and `damage` (torn/
   crushed/leaking) as extra classes.
3. **Export** as **"COCO"** (not "YOLOv8" / not a `data.yaml`). Unzip into this folder.
4. **Class order:** the order of categories in `_annotations.coco.json` = the
   `class_id` order. Pass the same order to the service as `RFDETR_CLASS_NAMES`
   (e.g. `bag,gap,damage`) so names match at inference.

## Train

```bash
cd detector-service
pip install -r requirements.txt
python train.py --dataset-dir ./dataset --epochs 100 --batch-size 4
# -> output/checkpoint_best.pth
```

Then bake `output/checkpoint_best.pth` into the image (copy to `weights/`) and set
`RFDETR_WEIGHTS` + `RFDETR_CLASS_NAMES`. See ../README.md.

> Labeling counts only the bags you can *see*. That's expected — the model estimates
> the visible face and layer count; the verifier's `layers × bagsPerLayer` gives the
> true total.
