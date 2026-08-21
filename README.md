# GXO Loadout

A React-based single-page application built with Vite and TypeScript for capturing and verifying inspection, returns, and shipment data at GXO facilities.

---

## 🎯 Bag Counting Vision System (SAM 3 + NVIDIA Cosmos Reason)

> **Current Phase**: **Phase 0 (Feasibility Spike Scripts Ready — VPS Benchmarking Next)**  
> **Architecture Plan & Roadmap**: See [**BAG_COUNT_PLAN.md**](BAG_COUNT_PLAN.md) for full architectural design, phase status, and live progress.  
> **Target VPS**: vast.ai (2× NVIDIA RTX 4090 24GB GPUs)  
> **Model Stack**: Meta SAM 3 (Zero-shot Bag Flap Segmentation) + NVIDIA Cosmos Reason (`cosmos-reason2-8b` Physical Multi-View Reasoning).

### Active Progress & Phase Status

- **Phase 0: Feasibility Spikes & Console Modernization** (`IN PROGRESS`):
  - ✔️ **Data Protection & Backup**: [`detector-service/backup_training_data.py`](detector-service/backup_training_data.py) & Browser JSON/CSV 1-click export in Console.
  - ✔️ **Console Upgrades**: [`public/bag-count-console.html`](public/bag-count-console.html) with Test/VLM inspection tab, SKU stacking recipe calculator, and 4-side capture protocol.
  - ✔️ **Feasibility Benchmark Harnesses**: [`detector-service/spike/`](detector-service/spike/) (`test_cosmos_reason_multiview.py`, `test_sam3_seedbags.py`, `test_target_isolation.py`).
  - ⏳ **Next**: Spin up vast.ai 2× RTX 4090 instance and execute Phase 0 spike tests.
- **Phase 1: Backend Purge & vast.ai Containerization** (`PENDING PHASE 0 RUN`)
- **Phase 2: Core Two-Model Service Implementation** (`PENDING`)
- **Phase 3: Inspection UI Integration & Discrepancy UI** (`PENDING`)
- **Phase 4: Calibration, Shadow Mode & Validation** (`PENDING`)

---

## Features
- **Load Inspections**: Scan and document outgoing loads with detailed pallet-by-pallet photographic evidence.
- **Returns Workflow**: Process incoming returns, verifying expected quantities against BOL data and photographing pallet condition.
- **Dynamic Semantic Photo Verification**: Enforces rigorous checklist of necessary photos (placards, product, conditions) based on dynamic pallet configurations.
- **Shared, offline-capable PWA**: Azure Table Storage is the source of truth for inspections and reference data, Azure Blob Storage holds photos, and IndexedDB provides an offline cache plus durable retry queue.
- **Barcode & QR Scanning**: Integrated ZXing barcode scanner to ingest LPNs, batch codes, and routing labels efficiently.
- **Image Quality Analysis**: Built-in computer vision rules engine checking captured photos for blurriness, darkness, and clipping before saving.

## Tech Stack
- **Framework**: React + Vite
- **Language**: TypeScript
- **State Management**: React Router + Context
- **Storage**: Azure Table Storage + Azure Blob Storage; IndexedDB (`idb`) offline cache
- **Routing**: React Router DOM
- **Scanner**: `html5-qrcode`

## Local Development
1. Run `npm install` to install dependencies.
2. Run `npm run dev` to start the local development server.
3. Open `http://localhost:5173` in your browser.

To exercise cross-device sync locally, run Azurite and copy
`api/local.settings.json.example` to `api/local.settings.json`. In Azure, set
`LOADOUT_STORAGE_CONNECTION_STRING` as a Static Web Apps application setting.
The connection string is used only by the Functions API and must never be placed
in a `VITE_*` variable. The warehouse app does not require user sign-in; shared
data routes are available to devices that can reach the site URL.

Existing deployments can keep the legacy `STORAGE_ACCOUNT_NAME` and
`STORAGE_ACCOUNT_KEY` API settings instead. When both are present, the API builds
the Storage connection internally; `LOADOUT_STORAGE_CONNECTION_STRING` takes
precedence when explicitly configured.

## Collecting training data

The detector has to be trained on real pallets from your own building. The
**Collect** tab of [`/bag-count-console.html`](public/bag-count-console.html) is
what the people gathering that data use — it runs on a phone, needs no login and
no GitHub account, and holds submissions on the device until they upload, so a
dead-signal aisle never costs someone a pallet they already walked around.

Each submission is one pallet: four side photos (all required), one to three
close-ups of the bag flap for the batch code and material description, and the
hand count broken out as **bags per layer**, **full layers**, and **partial top
count**. The console cross-checks that arithmetic against the collector's total
and flags a disagreement rather than silently trusting either number.

There are no name, site, or pallet-ID fields — every field between a collector
and the next pallet costs pallets, and the flap photo already carries the batch
and material. Submissions are told apart by their sample id plus an anonymous
per-device tag the console generates once and never shows.

Photos go to blob storage and counts to table storage via `/api/training/*`,
using the same `LOADOUT_STORAGE_CONNECTION_STRING` as the rest of the app. To
pull a batch into the repo for labeling:

```bash
cd detector-service
python sync_training_data.py --api https://<your-app>.azurestaticapps.net
```

**Review** shows every pallet that has landed on the server — thumbnails, counts,
and a flag on anything missing a face or whose total does not match its layers.
Delete a bad one there before it reaches the repo.

**Label** pulls the collected side photos straight off the server with one button,
so whoever labels never hunts for files. Flap close-ups are deliberately excluded:
they carry the batch code, they are not bag-flap detection images. Loaded images
are named `<batch>__<sample-id>__<ROLE>.jpg` so the train/valid/test split can be
made by whole pallet.

That writes `detector-service/dataset/raw/<batch-or-pallet>__<id>/` plus a
`samples.csv` of every ground-truth count. See
[`dataset/raw/README.md`](detector-service/dataset/raw/README.md) for the layout
and the Git LFS storage budget.

> These endpoints are anonymous, like the rest of the shared-data routes —
> anyone who can reach the site URL can submit a pallet. That is deliberate for
> now (collectors are handed a link, not credentials); the queue view lets you
> delete anything that should not be there, and `--purge-remote` clears the
> server once a batch is committed.

## Pallet bag-count vision assist

`POST /api/analyze-pallet-count` estimates the **layer count** of a single pallet
face from a photo, and `POST /api/analyze-pallet-faces` runs the same detector over
the four captured faces and sums the visible-bag counts. Layers × bags-per-layer is
the primary count and the verifier confirms it — the model is an assist, not the
source of truth, because sagging bags occlude each other badly enough that exact
visual counting is unreliable even for people.

The endpoints proxy to **one** backend, the self-hosted vision service in
[`detector-service/`](detector-service/), and return **501** if it is not
configured so the app degrades cleanly to manual layer entry:

```
DETECTOR_SERVICE_URL = http://<host>:<port>   # the detector-service /analyze endpoint
DETECTOR_SERVICE_KEY = <optional bearer key>  # only if the service sets DETECTOR_SERVICE_KEY
```

### Pallet vision

**NVIDIA Cosmos Reason 2** first isolates the intended pallet from background
pallets and bags. **SAM 3**, fine-tuned on the accepted `bag flap` masks, then
segments only that pallet crop. Ambiguous localization, a degraded service, or
fewer than three valid faces produces `needsReview` instead of an automatic count.
See [`detector-service/README.md`](detector-service/README.md).

### Honest limits

A detector sees only the **front + top faces**; interior bags are occluded, so the
per-face `estimatedBags` is a **visible-face** count, not the pallet total — the
client still does `layers × bags-per-layer` for the real number and the verifier
confirms it. Train a single `bag_flap` class first; keep damage checks in the human
inspection workflow rather than weakening the counting dataset with extra classes.

Admins use `/admin/bag-count-console` to keep each pallet's photos in one group,
verify the Cosmos pallet ROI, accept SAM 3 masks, and publish a versioned dataset.
The **Train SAM 3 bag-flap model** action rejects split leakage and missing masks,
fine-tunes on a GPU runner, and publishes the checkpoint and evaluation report.
The existing `/bag-count-console.html` Collect/Review/Label workflow remains
available for floor collection. Production counting stays fail-safe and manual
whenever `DETECTOR_SERVICE_URL` is unset or the GPU service reports degraded.

### Client-side image prep

[`palletVision.ts`](src/shared/services/palletVision.ts) downscales each
straight-from-camera photo (~2.5MB) before upload via `prepareForVision()`, which
also applies EXIF orientation — phone photos carry a rotation tag, and a sideways
frame makes the vertical layer count meaningless. This also keeps the round trip
inside the **45-second** Static Web Apps managed-function gateway timeout.

Never put `DETECTOR_SERVICE_URL`/`DETECTOR_SERVICE_KEY` in a `VITE_*` variable or
`.env` — anything Vite-prefixed is compiled into the browser bundle. The Function
proxies the detector so its URL/key stay server-side.


## Deployment
This app is designed to be deployed as a static web application. It handles routing on the client side, so ensure that the hosting environment (e.g., Azure Static Web Apps, Vercel, Netlify) is configured to rewrite all navigation requests to `index.html`.
