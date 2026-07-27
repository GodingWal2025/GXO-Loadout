# Pallet bag-count service (RF-DETR)

Vision backend for `POST /api/analyze-pallet-count`. The Azure Function proxies the
pallet-face photo bytes here; this service runs **RF-DETR** detection and returns the
JSON the client already consumes.

> **License:** RF-DETR (`Roboflow/rf-detr-base`) is **Apache-2.0** — commercial use
> in the closed-source GXO app is fine, no copyleft, no license fee. Only obligation
> is retaining the copyright/license notice. This is why it replaces AGPL YOLO26.

## What it returns

Same contract as before, derived from detections:

| field           | source                                                        |
|-----------------|---------------------------------------------------------------|
| `layers`        | box centers clustered into horizontal courses                 |
| `estimatedBags` | count of **visible-face** boxes (interior bags are occluded)  |
| `confidence`    | mean detection confidence                                     |
| `gaps`/`damage` | only if your fine-tuned model has those classes (see env)     |
| `topLayerFull`  | always `true` (a detector can't judge a partial top course)   |

The client still computes the real total as `layers × bagsPerLayer`; the visible
count is a cross-check the verifier confirms.

## Weights — you must fine-tune

The pretrained RF-DETR is COCO-trained and has **no bag class**. Train on your bags,
then point `RFDETR_WEIGHTS` at the checkpoint and list the class order in
`RFDETR_CLASS_NAMES`.

```python
# 1. Label ~200–500 pallet-face photos in Roboflow (class "bag"; optionally
#    "gap" and "damage"). Export as "COCO" -> a dataset dir with _annotations.
# 2. Train (Roboflow's own tooling — matches the confirm-loop dataset source):
from rfdetr import RFDETRBase
model = RFDETRBase()
model.train(dataset_dir="pallet-bags-coco", epochs=100, batch_size=4, lr=1e-4)
# 3. Use output/checkpoint_best.pth as RFDETR_WEIGHTS.
```

Your confirmed pallet photos from the verifier confirm-loop are the dataset source.

## Run locally

```bash
cd detector-service
pip install -r requirements.txt
RFDETR_WEIGHTS=weights/checkpoint_best.pth RFDETR_CLASS_NAMES=bag,gap,damage \
  uvicorn app:app --port 8080
# smoke test:
curl -s --data-binary @sample.jpg -H 'Content-Type: application/octet-stream' \
  http://localhost:8080/analyze | jq
```

Without `RFDETR_WEIGHTS` it loads the COCO base model (no bag class) — fine for
checking the server responds, useless for real counts.

## Deploy (Azure Container Apps, CPU)

```bash
az containerapp up \
  --name pallet-detector --resource-group <rg> \
  --source . --ingress external --target-port 8080
```

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
| `RFDETR_WEIGHTS`       | *(COCO base)*  | fine-tuned `.pth` checkpoint path             |
| `RFDETR_CONF`          | `0.5`          | confidence threshold                          |
| `RFDETR_RESOLUTION`    | *(model dflt)* | inference resolution (multiple of 56)         |
| `RFDETR_CLASS_NAMES`   | *(model names)*| ordered class names, id 0..N-1, comma-sep     |
| `RFDETR_BAG_CLASSES`   | *(all)*        | class name(s) counted as bags                 |
| `RFDETR_GAP_CLASSES`   | *(none)*       | class name(s) meaning a gap                   |
| `RFDETR_DAMAGE_CLASSES`| *(none)*       | class name(s) meaning damage                  |
| `DETECTOR_SERVICE_KEY` | *(none)*       | require `Authorization: Bearer <key>` if set  |
