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
2. **Label** in [Roboflow](https://roboflow.com) or [CVAT]. Draw one box around each
   visible front-facing bag flap and use the single class `bag_flap`.
3. **Export** as **"COCO"** (not "YOLOv8" / not a `data.yaml`). Unzip into this folder.
4. **Class order:** the order of categories in `_annotations.coco.json` = the
   `class_id` order. Pass the same order to the service as `RFDETR_CLASS_NAMES`
   (`bag_flap`) so names match at inference.

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
