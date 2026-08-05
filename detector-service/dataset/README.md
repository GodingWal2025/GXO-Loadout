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

1. **Collect** with the **Collect** tab of `/bag-count-console.html`. Collectors shoot
   four sides of a pallet plus one to three bag-flap close-ups and enter the hand
   count; `python sync_training_data.py --api <app-url>` pulls it all into
   [`raw/`](raw/README.md) with the ground-truth counts in `raw/samples.csv`. Aim
   for 200–500 faces across the bag types, lighting, and stack heights you actually
   see. Variety matters more than raw count.
2. **Label** the four side photos on the console's **Label** tab (or in
   [Roboflow](https://roboflow.com) / CVAT). Draw one box around each visible
   front-facing bag flap and use the single class `bag_flap`. The flap close-ups are
   reference for batch/material, not detector training images — do not label them.
3. **Export** as **"COCO"** (not "YOLOv8" / not a `data.yaml`). Unzip into this folder.
4. **Class order:** the order of categories in `_annotations.coco.json` = the
   `class_id` order. Pass the same order to the service as `RFDETR_CLASS_NAMES`
   (`bag_flap`) so names match at inference.

`raw/` holds the unlabeled originals and is committed; `train/`, `valid/`, and `test/`
are cut from it and gitignored, since they are reproducible from `raw/` plus the
annotations.

Split by **whole pallet**, not by random image. Different views of one pallet must
stay in one split or the evaluation score will be misleadingly high. Target 70%
train, 15% validation, and 15% held-out test.

## Train

```bash
cd detector-service
pip install -r requirements.txt
python validate_dataset.py --dataset-dir ./dataset
python train.py --dataset-dir ./dataset --model-size small --epochs 100 --batch-size 4
# -> output/checkpoint_best.pth
```

Then bake `output/checkpoint_best.pth` into the image (copy to `weights/`) and set
`RFDETR_WEIGHTS` + `RFDETR_CLASS_NAMES`. See ../README.md.

> Labeling counts only the bags you can *see*. That's expected — the model estimates
> the visible face and layer count; the verifier's `layers × bagsPerLayer` gives the
> true total.

The GitHub training action requires at least 20 images in each split and rejects
a checkpoint below 85% exact-layer accuracy, 95% within-one-layer accuracy, or
above 1.5 visible-bag mean absolute error on the held-out test set.
