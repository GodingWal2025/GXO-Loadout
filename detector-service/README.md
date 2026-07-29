# Pallet bag-count service

Vision backend for `POST /api/analyze-pallet-count`. The Azure Function proxies the
pallet-face photo bytes here; this service runs detection and returns the JSON the
client already consumes.

Two interchangeable backends, selected with `DETECTOR_BACKEND`:

| backend  | when                | weights needed            | quality |
|----------|---------------------|---------------------------|---------|
| `owlv2`  | wiring test / pre-labeling | **none** (text prompts) | **not usable for counts** — see below |
| `rfdetr` | production *(default)* | fine-tuned `.pth`      | good, once trained on your bags |

> **Tested 2026-07-29 on the real Bags_Phots pallets — OWLv2 zero-shot does not
> work on shrink-wrapped seed pallets.** Across prompt sets (`a bag of seed`,
> `a white bag`, `a sack`) and thresholds 0.05–0.20, boxes either span several
> layers at once or collapse onto the DEKALB logo; counts ranged 2–104 on one
> image holding ~12 visible bags. Prompting for *layers* instead of bags was no
> better. Use it to prove the wiring and to pre-seed labels, not for numbers.

> **License:** RF-DETR (`Roboflow/rf-detr-base`) and OWLv2
> (`google/owlv2-base-patch16-ensemble`) are both **Apache-2.0** — commercial use
> in the closed-source GXO app is fine, no copyleft, no license fee. Only obligation
> is retaining the copyright/license notice. This is why they replace AGPL YOLO26.

## Why the zero-shot backend exists

RF-DETR's pretrained checkpoint is COCO-trained and has **no bag class**, so before
any labeling the service returns zero detections on every pallet. OWLv2 is
open-vocabulary — it detects from text prompts — so it at least exercises the full
path (photo → Function → service → client JSON) with no training data.

That is all it earns. On the measured evidence above its counts are not meaningful
on this product, so there is **no shortcut around labeling**: a trustworthy bag or
layer count needs the fine-tuned RF-DETR path below.

## What it returns

Same contract for both backends:

| field           | source                                                        |
|-----------------|---------------------------------------------------------------|
| `layers`        | box centers clustered into horizontal courses                 |
| `estimatedBags` | count of **visible-face** boxes (interior bags are occluded)  |
| `confidence`    | mean detection confidence                                     |
| `gaps`/`damage` | only if your fine-tuned model has those classes (see env)     |
| `topLayerFull`  | always `true` (a detector can't judge a partial top course)   |

The client still computes the real total as `layers × bagsPerLayer`; the visible
count is a cross-check the verifier confirms.

> Uploaded photos are passed through `ImageOps.exif_transpose` before inference.
> Phone cameras store landscape sensor data plus an orientation tag, so a portrait
> pallet photo decodes sideways — and layer clustering, which groups boxes by
> vertical position, is meaningless on a rotated frame.

## Run the demo (no weights, no GPU)

```bash
cd detector-service
py -3.13 -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt -r requirements-owlv2.txt --extra-index-url https://download.pytorch.org/whl/cpu
.venv/Scripts/python demo.py --src ~/Desktop/Bags_Phots --out demo-output --backend owlv2
```

Writes annotated JPEGs (numbered boxes + a per-image banner) and `results.json` to
`demo-output/`. First run downloads the ~600MB OWLv2 snapshot from HuggingFace.

Or serve it:

```bash
DETECTOR_BACKEND=owlv2 .venv/Scripts/python -m uvicorn app:app --port 8080
curl -s --data-binary @pallet.jpg -H 'Content-Type: application/octet-stream' \
  http://localhost:8080/analyze | jq
```

`GET /health` reports the active backend, model version, and (for owlv2) the prompts.

## Weights — fine-tune for production

Train on your bags, then point `RFDETR_WEIGHTS` at the checkpoint and list the class
order in `RFDETR_CLASS_NAMES`. See [dataset/README.md](dataset/README.md) and
`train.py`.

```bash
python train.py --dataset-dir ./dataset --epochs 100 --batch-size 4
# -> output/checkpoint_best.pth
```

Label ~200–500 pallet-face photos in Roboflow (class `bag`; optionally `gap` and
`damage`), export as **COCO**. Your confirmed pallet photos from the verifier
confirm-loop are the dataset source. Running `demo.py` with `--backend owlv2` first
gives you rough boxes to correct rather than drawing every box from scratch.

## Deploy (Azure Container Apps, CPU)

`--source .` builds in the cloud, so no local Docker is required.

```bash
az containerapp up \
  --name pallet-detector --resource-group <rg> \
  --source . --ingress external --target-port 8080
```

The image defaults to `DETECTOR_BACKEND=owlv2` and bakes the model in at build time
(a cold start would otherwise pay a ~600MB download). For the production backend:
`--build-arg DETECTOR_BACKEND=rfdetr` with your checkpoint in `weights/`.

Give it real memory — OWLv2 on CPU needs headroom and takes a few seconds per image:

```bash
az containerapp update -g <rg> -n pallet-detector --cpu 2 --memory 4Gi --min-replicas 1
```

`--min-replicas 1` avoids scale-to-zero cold starts during a live demo.

Then point the Function at it:

```bash
az functionapp config appsettings set -g <rg> -n <func> --settings \
  DETECTOR_SERVICE_URL="https://pallet-detector.<region>.azurecontainerapps.io" \
  DETECTOR_SERVICE_KEY="<optional shared secret, matches this service's env>"
```

`DETECTOR_SERVICE_URL` takes precedence over the Cosmos NIM vars. Unset it to fall
back to the NIM; unset both and the endpoint returns 501 (manual layer entry).

## Env vars

| var                    | default        | meaning                                       |
|------------------------|----------------|-----------------------------------------------|
| `DETECTOR_BACKEND`     | `rfdetr`       | `rfdetr` or `owlv2`                           |
| `RFDETR_WEIGHTS`       | *(COCO base)*  | fine-tuned `.pth` checkpoint path             |
| `RFDETR_CONF`          | `0.5`          | confidence threshold                          |
| `RFDETR_RESOLUTION`    | *(model dflt)* | inference resolution (multiple of 56)         |
| `RFDETR_CLASS_NAMES`   | *(model names)*| ordered class names, id 0..N-1, comma-sep     |
| `RFDETR_BAG_CLASSES`   | *(all)*        | class name(s) counted as bags                 |
| `RFDETR_GAP_CLASSES`   | *(none)*       | class name(s) meaning a gap                   |
| `RFDETR_DAMAGE_CLASSES`| *(none)*       | class name(s) meaning damage                  |
| `OWL_MODEL`            | `google/owlv2-base-patch16-ensemble` | HF model id             |
| `OWL_PROMPTS`          | `a bag of seed,a sack,a bag` | comma-sep text queries          |
| `OWL_CONF`             | `0.20`         | score threshold (OWLv2 scores run low)        |
| `OWL_IOU`              | `0.50`         | NMS IoU — dedupes the same bag across prompts |
| `DETECTOR_SERVICE_KEY` | *(none)*       | require `Authorization: Bearer <key>` if set  |
