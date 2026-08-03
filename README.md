# GXO Loadout

A React-based single-page application built with Vite and TypeScript for capturing and verifying inspection, returns, and shipment data at GXO facilities.

## Features
- **Load Inspections**: Scan and document outgoing loads with detailed pallet-by-pallet photographic evidence.
- **Returns Workflow**: Process incoming returns, verifying expected quantities against BOL data and photographing pallet condition.
- **Dynamic Semantic Photo Verification**: Enforces rigorous checklist of necessary photos (placards, product, conditions) based on dynamic pallet configurations.
- **Device-local PWA**: Uses IndexedDB for resilient offline storage. Inspections and photos intentionally stay on the warehouse device; there is no cloud sync queue.
- **Barcode & QR Scanning**: Integrated ZXing barcode scanner to ingest LPNs, batch codes, and routing labels efficiently.
- **Image Quality Analysis**: Built-in computer vision rules engine checking captured photos for blurriness, darkness, and clipping before saving.

## Tech Stack
- **Framework**: React + Vite
- **Language**: TypeScript
- **State Management**: React Router + Context
- **Storage**: IndexedDB (`idb`)
- **Routing**: React Router DOM
- **Scanner**: `html5-qrcode`

## Local Development
1. Run `npm install` to install dependencies.
2. Run `npm run dev` to start the local development server.
3. Open `http://localhost:5173` in your browser.

## Pallet bag-count vision assist

`POST /api/analyze-pallet-count` estimates the **layer count** of a single pallet
face from a photo, and `POST /api/analyze-pallet-faces` runs the same detector over
the four captured faces and sums the visible-bag counts. Layers × bags-per-layer is
the primary count and the verifier confirms it — the model is an assist, not the
source of truth, because sagging bags occlude each other badly enough that exact
visual counting is unreliable even for people.

Both endpoints proxy to **one** backend, the self-hosted detector in
[`detector-service/`](detector-service/), and return **501** if it is not
configured so the app degrades cleanly to manual layer entry:

```
DETECTOR_SERVICE_URL = http://<host>:<port>   # the detector-service /analyze endpoint
DETECTOR_SERVICE_KEY = <optional bearer key>  # only if the service sets DETECTOR_SERVICE_KEY
```

### The detector (Apache-2.0, no copyleft)

The service runs one of two interchangeable, Apache-2.0-licensed detection backends
(`DETECTOR_BACKEND`) — both safe to call from this closed-source app:

- **RF-DETR Small** (`rfdetr`, production default) — the best starting balance of
  accuracy, inference time, and training cost. The COCO base
  has no *bag* class, so it needs a checkpoint **fine-tuned on labeled pallet
  photos** before it counts anything. See [`detector-service/README.md`](detector-service/README.md).
- **OWLv2** (`owlv2`, wiring/pre-labeling only) — works without training data, but
  measured counts on shrink-wrapped seed pallets were not reliable enough for use.

> AGPL-licensed detectors such as Ultralytics YOLO were deliberately **not** used:
> serving them over HTTP would trip AGPL's network clause and obligate open-sourcing
> the service. RF-DETR and OWLv2 are Apache-2.0 and carry no such requirement.

### Honest limits

A detector sees only the **front + top faces**; interior bags are occluded, so the
per-face `estimatedBags` is a **visible-face** count, not the pallet total — the
client still does `layers × bags-per-layer` for the real number and the verifier
confirms it. Train a single `bag_flap` class first; keep damage checks in the human
inspection workflow rather than weakening the counting dataset with extra classes.

Open [`/bag-count-console.html`](https://white-meadow-0dc31e50f.7.azurestaticapps.net/bag-count-console.html)
to label/export images, verify API health, and visualize `eval-results.json`. The
manual **Train RF-DETR** GitHub Action validates the dataset, trains the chosen
model size, evaluates the held-out split, and publishes checkpoint/results artifacts.

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
