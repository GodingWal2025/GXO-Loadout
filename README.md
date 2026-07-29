# GXO Loadout

A React-based single-page application built with Vite and TypeScript for capturing and verifying inspection, returns, and shipment data at GXO facilities.

## Features
- **Load Inspections**: Scan and document outgoing loads with detailed pallet-by-pallet photographic evidence.
- **Returns Workflow**: Process incoming returns, verifying expected quantities against BOL data and photographing pallet condition.
- **Dynamic Semantic Photo Verification**: Enforces rigorous checklist of necessary photos (placards, product, conditions) based on dynamic pallet configurations.
- **Offline-First PWA**: Uses local browser storage (IndexedDB via IDB-Keyval) for fast, persistent state management.
- **Barcode & QR Scanning**: Integrated ZXing barcode scanner to ingest LPNs, batch codes, and routing labels efficiently.
- **Image Quality Analysis**: Built-in computer vision rules engine checking captured photos for blurriness, darkness, and clipping before saving.

## Tech Stack
- **Framework**: React + Vite
- **Language**: TypeScript
- **State Management**: React Router + Context
- **Storage**: IndexedDB (`idb-keyval`)
- **Routing**: React Router DOM
- **Scanner**: `@zxing/browser`

## Local Development
1. Run `npm install` to install dependencies.
2. Run `npm run dev` to start the local development server.
3. Open `http://localhost:5173` in your browser.

## Pallet bag-count vision assist

`POST /api/analyze-pallet-count` estimates the **layer count** of a pallet face from
a photo. Layers × bags-per-layer is the primary count and the verifier confirms it —
the model is an assist, not the source of truth, because sagging bags occlude each
other badly enough that exact visual counting is unreliable even for people.

The Function picks a backend in this order, and returns **501** if none is set so
the app degrades cleanly to manual layer entry:

1. `DETECTOR_SERVICE_URL` — the self-hosted detector in [`detector-service/`](detector-service/)
   (RF-DETR; needs fine-tuned weights). See its README.
2. `COSMOS_NIM_URL` / `COSMOS_NIM_KEY` / `COSMOS_NIM_MODEL` — any
   **OpenAI-compatible vision endpoint**, self-hosted or hosted.

### Using an NVIDIA-hosted model (no infrastructure)

Because path 2 is just OpenAI-compatible `/chat/completions`, NVIDIA's hosted NIMs
work as a config change with no code change. Set these in the Azure Portal on the
Static Web App under **Settings → Environment variables** (older docs call this
"Configuration → Application settings"), with the environment set to **Production**.
The API is SWA-*managed* (`api_location: "api"`), so these live on the SWA itself —
there is no separate Function App, and they are read by the managed API at runtime,
not baked into the frontend bundle:

```
COSMOS_NIM_URL        = https://integrate.api.nvidia.com/v1
COSMOS_NIM_KEY        = nvapi-...          # free key from build.nvidia.com
COSMOS_NIM_MODEL      = nvidia/cosmos3-nano-reasoner
COSMOS_NIM_MAX_TOKENS = 1536               # optional; default 1536
```

`COSMOS_NIM_URL` must include `/v1` — without it the Function builds
`https://integrate.api.nvidia.com/chat/completions` and NVIDIA answers 404.

**Reasoning models need token headroom.** Cosmos narrates inside `<think>…</think>`
before answering, so a 512-token budget can be exhausted mid-thought and return no
JSON at all — which looks like a broken model rather than a truncated reply. Hence
the 1536 default. Drop it to 512 for a direct-answering VLM if latency starts
pressing the 45s gateway limit.

Never put the key in a `VITE_*` variable or `.env` — anything Vite-prefixed is
compiled into the browser bundle. The Function proxies it so it stays server-side.

To compare candidate models against real pallet photos before configuring anything,
use [`detector-service/try_nvidia.py`](detector-service/try_nvidia.py) — it sends the
exact prompt the Function sends.

Two constraints this path imposes:

- **Inline image size.** Hosted endpoints reject inline base64 beyond ~180KB.
  Straight-from-camera photos are ~2.5MB, so `prepareForVision()` in
  [`palletVision.ts`](src/shared/services/palletVision.ts) downscales client-side
  before upload. It also applies EXIF orientation — phone photos carry a rotation
  tag, and a sideways frame makes the vertical layer count meaningless.
- **45-second gateway timeout.** Static Web Apps cuts off managed-function HTTP
  responses at 45s even though the function keeps running. The downscale plus
  `max_tokens: 512` keeps a reasoning VLM inside it; if a model proves too slow,
  a smaller VLM is the fix.

## Deployment
This app is designed to be deployed as a static web application. It handles routing on the client side, so ensure that the hosting environment (e.g., Azure Static Web Apps, Vercel, Netlify) is configured to rewrite all navigation requests to `index.html`.
