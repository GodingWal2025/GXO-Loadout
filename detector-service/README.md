# Pallet vision service

This GPU service replaces the former detector with a two-stage pipeline:

1. NVIDIA Cosmos Reason 2 returns the target pallet, primary visible face, face
   quadrilateral, orientation, visibility, and geometry confidence.
2. When the geometry gates pass, OpenCV rectifies only that face into a canonical
   front-facing image. Adjacent visible faces are excluded from the counting input.
3. SAM 3 segments `bag flap` instances on the canonical image. Its masks are
   inverse-warped to source-image coordinates for the existing browser overlays.
4. Unsafe or failed rectification automatically uses the former raw ROI crop path.

The Azure Function sends all four face images in one `/analyze-faces` request.
Cosmos localization runs concurrently; SAM 3 inference is serialized through one
bounded GPU slot. The service returns HTTP 429 when the queue is full.

## GPU VPS deployment

Create `/workspace/models/sam3/bag-flap/current/model.pt`, copy
`.env.gpu.example` to `.env`, fill the service key, Cosmos image, and NGC key, then:

```bash
docker compose --env-file .env -f docker-compose.gpu.yml up -d --build
curl http://127.0.0.1:8080/health
```

Only port 8080 is bound, and only to loopback. Put TLS/firewall access in front of
it for the Azure Function. The Cosmos container remains private to the Compose
network. Configure the Function with:

```text
DETECTOR_SERVICE_URL=https://your-private-vision-host
DETECTOR_SERVICE_KEY=the-same-long-random-secret
```

Important environment values:

| Variable | Purpose |
| --- | --- |
| `SAM3_CHECKPOINT` | Approved SAM 3 checkpoint mounted read-only |
| `SAM3_CONFIDENCE` | Instance threshold; default `0.45` |
| `COSMOS_URL` | OpenAI-compatible Cosmos chat-completions URL |
| `COSMOS_MODEL` | Cosmos model identifier |
| `COSMOS_MIN_CONFIDENCE` | Below this, localization requires review; provisional default `0.70` |
| `COSMOS_MIN_GEOMETRY_CONFIDENCE` | Minimum geometry confidence for rectification; default `0.70` |
| `PALLET_MIN_FACE_VISIBILITY` | Minimum visible fraction of the selected face; default `0.55` |
| `PALLET_MAX_RECTIFY_SKEW` | Maximum normalized edge-length skew; default `0.70` |
| `PALLET_RECTIFICATION_MODE` | `prefer` (default), `off` (raw control), or `shadow` (run and report both) |
| `DETECTOR_SERVICE_KEY` | Required bearer secret outside explicit stub tests |
| `MAX_QUEUE_DEPTH` | Maximum waiting/in-flight requests; default `4` |
| `SAM3_STUB_MODE` | Contract tests only; never production |
| `COSMOS_DISABLED` | Degraded contract tests only; forces review |

## API contract

- `GET /health` is an unauthenticated readiness probe and contains no secrets.
- `POST /analyze-faces` accepts all captured face data URLs and returns the legacy
  counting fields plus ROI, masks, display polygons, geometry, rectification,
  A/B comparison telemetry, and `needsReview`.
- `POST /propose-flaps` accepts an image, verified target ROI, optional positive
  prompt boxes, and returns SAM 3 proposals for the admin console.
- `POST /locate-pallet` runs Cosmos alone for admin ROI verification.
- Count responses expose a model-neutral `counterHeads` boundary (`densityCount`,
  `bagCenters`, `countClass`, and confidence) reserved for the later DINOv3
  specialist. SAM 3 leaves those specialist values empty while retaining masks.
- `POST /analyze` retains the raw-image compatibility contract.

All POST routes require `Authorization: Bearer <DETECTOR_SERVICE_KEY>`.

## Dataset and training

Use `/bag-count-console.html` in the web app. Each real pallet is one group, and
the deterministic split is assigned at group level. Uploads are EXIF-normalized,
deduplicated by SHA-256, and exported with a target pallet box and accepted COCO
RLE masks. A reviewed zero-flap photo is a valid negative example.

After extracting the console ZIP:

```bash
python prepare_dataset.py --source ./dataset-export --output ./dataset
python validate_dataset.py --dataset-dir ./dataset --require-test
git clone https://github.com/facebookresearch/sam3.git ./sam3-source
git -C ./sam3-source checkout 8f0b7f4d4e7eda2ed606ebde6702c93359ad01da
pip install -e "./sam3-source[train]"
python train.py --dataset-dir ./dataset --output-dir ./output/sam3 --sam3-repo ./sam3-source
python eval.py --dataset-dir ./dataset \
  --weights ./output/sam3/checkpoints/checkpoint.pt \
  --min-exact-layer-accuracy .85 --min-within-one-layer-accuracy .95 \
  --max-visible-bag-mae 1.5 --min-box-iou .55
```

`requirements-sam3.txt` pins the upstream SAM 3 revision. The training overlay
enables segmentation and mask/dice loss; it is layered on Meta's official
Roboflow training configuration. The GitHub workflow requires a self-hosted runner
labeled `gpu` and a `DATASET_BLOB_URL` secret pointing at the reviewed ZIP.

Do not promote a checkpoint merely because training completed. Promote only when
the held-out pallet-group test split passes the release gates, then atomically
update `/workspace/models/sam3/bag-flap/current/model.pt` and restart the service.
