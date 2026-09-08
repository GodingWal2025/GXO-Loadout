## Features

- **Product reconciliation**: Expected and actual quantities are shown by SKU, batch, unit, and delivery grouping. Bags, Seedpaks, and Minibulks are kept separate. Inbound records do not contain expected quantities, so their expected column is explicitly unknown rather than inferred.
- **Document recovery**: Verify screens pair captured pages with editable extracted fields and explicit OCR-row confirmation. Failed picklist extraction can retain the image for manual entry, and batch barcodes can be read from a tag picture.
- **Shift handoff**: Handoff notes and inspector transfers are available inside each inspection and retained across devices, including concurrent note additions. The home screen keeps the simpler workflow and inspection lists.
- **Save visibility**: A persistent banner distinguishes pending local writes, device save failures, queued uploads, and cloud confirmation. Failed local writes can be retried while the app remains open; the app requests a browser warning before leaving with an unfinished or failed local write.
- **Supervisor queue**: The admin dashboard prioritizes flagged and stalled work, with search, a configurable inactivity threshold, and repeated flag reasons from the last 14 days. This live queue is separate from historical chart date filters.
- **Evidence package**: Download a ZIP from the final review page containing a printable HTML report, referenced document/pallet images, the inspection JSON, and a manifest. Missing images are reported in both the export and the UI; reconnect and export again to retrieve unavailable cloud images. Resolution notes preserve context without automatically clearing the underlying flags.
- **Load inspections**: Scan and document outgoing loads with detailed pallet-by-pallet photographic evidence.
- **Returns workflow**: Process incoming returns, verifying expected quantities against BOL data and photographing pallet condition.
- **Dynamic semantic photo verification**: Enforces a checklist of required photos based on the pallet configuration.
- **Shared, offline-capable PWA**: Azure Table Storage is the source of truth for inspections and reference data, Azure Blob Storage holds photos, and IndexedDB provides an offline cache plus durable retry queue.
- **Barcode and QR scanning**: Uses direct tag-picture capture and `html5-qrcode` to populate batch codes.
- **Image quality analysis**: Checks captured photos for blurriness, darkness, and clipping before saving.

## Tech Stack

- **Framework**: React + Vite
- **Language**: TypeScript
- **State management**: React Context
- **Storage**: Azure Table Storage and Azure Blob Storage with an IndexedDB (`idb`) offline cache
- **Routing**: React Router DOM
- **Scanner**: `html5-qrcode`

## Local Development

1. Run `npm install` to install dependencies.
2. Run `npm run dev` to start the local development server.
3. Open `http://localhost:5173` in your browser.

### Finding your way around the code

- `src/main.tsx` starts the app and background synchronization; `src/App.tsx` maps URLs to screens.
- `src/routes/` contains workflow screens. Each screen coordinates user actions and saves inspection updates.
- `src/shared/types/inspection.ts` defines inspection records; `src/shared/rules/` contains validation and completion rules.
- `src/shared/services/db.ts` saves records and photos locally and queues changes. `sync.ts` exchanges those changes with the API when connectivity is available.
- `src/shared/camera/` handles capture and image checks. `useQualityCheckedCapture.ts` shares the quality-review flow; each calling screen decides how to save an accepted photo.
- `api/src/` contains the Azure Functions backend. `detector-service/` contains the separate vision service and training tools.

Document captures save photo IDs in the inspection and image blobs separately in IndexedDB. Temporary `blob:` preview URLs belong to the current browser session and must be released when no longer needed.

Run `npm test` for the TypeScript test suite and `npm run build` for type checking and the production PWA build.

To exercise cross-device sync locally, run Azurite and copy `api/local.settings.json.example` to `api/local.settings.json`. In Azure, set `LOADOUT_STORAGE_CONNECTION_STRING` as a Static Web Apps application setting. The connection string is used only by the Functions API and must never be placed in a `VITE_*` variable. The warehouse app does not require user sign-in; shared data routes are available to devices that can reach the site URL.

Existing deployments can keep the legacy `STORAGE_ACCOUNT_NAME` and `STORAGE_ACCOUNT_KEY` API settings instead. When both are present, the API builds the Storage connection internally; `LOADOUT_STORAGE_CONNECTION_STRING` takes precedence when explicitly configured.
