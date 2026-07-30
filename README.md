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

## Pallet bag counting

Bag counts are entered by the verifier. The layer-geometry helper on the pallet
screen computes `bags-per-layer × full-layers + partial` — more reliable than
eyeballing sagging, occluded bags — and the verifier applies the product as the
actual count. There is no vision/ML model in this path.

## Deployment
This app is designed to be deployed as a static web application. It handles routing on the client side, so ensure that the hosting environment (e.g., Azure Static Web Apps, Vercel, Netlify) is configured to rewrite all navigation requests to `index.html`.
