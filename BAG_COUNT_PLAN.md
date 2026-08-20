# Bag Counting Vision System: Architecture, Roadmap & Live Status

> **Live Status**: **Phase 0 & Phase 2 Core Service Completed (Dual NVIDIA RTX 5090 Verified)**  
> **Environment**: vast.ai VPS (2× NVIDIA RTX 5090 32GB GPUs)  
> **Model Stack**: Meta SAM 3 (`sam3`) on GPU 1 + NVIDIA Cosmos Reason (`nvidia/Cosmos-Reason2-8B`) on GPU 0 + Deterministic Stacking Recipe Reconciliation.

---

## Current Status & Progress Tracker

```mermaid
flowchart LR
    P0["Phase 0: Feasibility Spikes\n(COMPLETED on Dual 5090s)"] --> P1["Phase 1 & 2: Core Service\n(COMPLETED: vlm_reason2 + sam3 + recon)"]
    P1 --> P3["Phase 3: Inspection UI Integration\n(ScanPalletRoute & Discrepancies)"]
    P3 --> P4["Phase 4: Calibration & Shadow Mode\n(Target <= 1.0% False Accepts)"]

    classDef done fill:#0d5c36,stroke:#27ae60,color:#fff;
    classDef current fill:#1a4d7a,stroke:#3498db,color:#fff;
    classDef pending fill:#2d3748,stroke:#4a5568,color:#cbd5e0;

    class P0,P1 done;
    class P3 current;
    class P4 pending;
```

### Phase-by-Phase Breakdown

| Phase | Phase Name | Status | Deliverables Completed / Next |
| :--- | :--- | :---: | :--- |
| **Phase 0** | **Feasibility Spikes & VPS Benchmarks** | **COMPLETED** | ✔️ `detector-service/backup_training_data.py`<br>✔️ `public/bag-count-console.html` (Test tab, SKU calc, JSON/CSV export)<br>✔️ `detector-service/spike/test_cosmos_reason_multiview.py` (100% schema valid & repeatable)<br>✔️ `detector-service/spike/test_target_isolation.py` (141 samples evaluated)<br>✔️ Meta SAM 3 benchmarked on GPU 1 (0.9801 confidence) |
| **Phase 1 & 2** | **Core Two-Model Service Implementation** | **COMPLETED** | ✔️ `vlm_reason2.py` (NVIDIA Cosmos Reason on GPU 0)<br>✔️ `sam3_detector.py` (Meta SAM 3 on GPU 1)<br>✔️ `reconciliation.py` (Deterministic SKU Recipe Triangulation)<br>✔️ `app.py` (Exposed `POST /api/v1/analyze-pallet`) |
| **Phase 3** | **Inspection UI & Discrepancy Resolution** | **IN PROGRESS** | • Wire `ScanPalletRoute.tsx` into live detector endpoint<br>• Inspector visual overlay & reason code breakdown |
| **Phase 4** | **Calibration, Shadow Mode & Validation** | *Pending* | • Calibrate against 40% Train / 30% Calib / 30% Locked Test split<br>• Enforce Upper 95% Confidence Bound $\le 1.0\%$ false accepts |

---

## 1. System Architecture

```mermaid
flowchart TD
    subgraph Capture["Pallet Capture Flow (PWA)"]
        P_SIDES["4 Ordered Side Photos\n(FRONT, RIGHT, BACK, LEFT)"]
        P_FLAP["Flap Close-up Photo\n(Batch / SKU Barcode)"]
    end

    subgraph Preprocess["Preprocess & Identification"]
        Q_CHECK["Framing & Quality Validation"]
        BARCODE["Barcode / OCR Decoding"]
        SKU_RECIPE["Versioned Stacking Recipe\n(Azure Table Storage / Offline Cache)"]
    end

    subgraph Service["Detector Service (vast.ai 2× RTX 4090)"]
        subgraph GPU0["GPU 0 (NVIDIA Cosmos Reason 2)"]
            VLM_LOC["1. Target Pallet Isolation Validation"]
            VLM_BLIND["2. Blind Structural Multi-View Analysis\n(Layers, partial top, stack regularity)"]
        end
        subgraph GPU1["GPU 1 (Meta SAM 3.1)"]
            SAM_SEG["3. Scoped Bag-Flap Segmentation\n(Inside isolated target region)"]
        end
        subgraph Logic["Deterministic Reconciliation Logic"]
            GEOM["4. Mask Centroid Clustering & Layer Geometry"]
            RECON["5. Triangulate Evidence Sources\n(SAM + VLM + Recipe)"]
            GATE["6. Calibrated Confidence Gate"]
        end
        subgraph Discrepancy["Discrepancy Resolution (Conditional)"]
            VLM_EXPLAIN["7. VLM Pass 2 (With Overlays)\nInspector Discrepancy Explanation"]
        end
    end

    Capture --> Preprocess
    P_SIDES --> Q_CHECK
    P_FLAP --> BARCODE --> SKU_RECIPE

    Q_CHECK --> VLM_LOC --> SAM_SEG --> GEOM --> RECON
    Q_CHECK --> VLM_BLIND --> RECON
    SKU_RECIPE --> RECON

    RECON --> GATE
    GATE -->|Disagreement / Low Confidence| VLM_EXPLAIN
    GATE -->|Decision Ready| OUT["Final Response\n(Decision, Reason Codes, Evidence)"]
    VLM_EXPLAIN --> OUT
```

---

## 2. Completed Work Details (Phase 0)

1. **Zero Data Loss & Backup Protection**:
   - Built [`detector-service/backup_training_data.py`](detector-service/backup_training_data.py) to locally pull and archive all Azure training manifests, CSV ground-truth data, and JPEG images.
   - Built browser-side 1-click **"Backup JSON"** and **"Export CSV"** buttons into the Bag-Count Console Review panel.
2. **Optimized Capture Protocol**:
   - Eliminated top photo requirements (seed pallets are 60BG full stacks covered with opaque top sheets).
   - Standardized on **4 square-on side views** (`FRONT`, `RIGHT`, `BACK`, `LEFT`) + flap close-ups.
3. **Console Modernization**:
   - Added SKU stacking recipe preview and validation.
   - Added interactive **Test / VLM** tab with multi-view analysis inspection.
4. **Spike Test Scripts**:
   - `detector-service/spike/test_cosmos_reason_multiview.py`: Tests 4-image single-request ingestion, 2x2 contact sheet fallback, and layer repeatability.
   - `detector-service/spike/test_sam3_seedbags.py`: Evaluates zero-shot flap segmentation precision/recall at $\text{IoU} = 0.50$.
   - `detector-service/spike/test_target_isolation.py`: Evaluates target pallet framing (70% frame) and background clutter rejection.

---

## 3. Next Action Items (vast.ai Benchmarking)

1. **Rent 2× RTX 4090 Instance on vast.ai**:
   - Run NVIDIA Cosmos Reason (`cosmos-reason2-8b`) container on GPU 0.
   - Run PyTorch 2.7+ / Meta SAM 3 checkpoint on GPU 1.
2. **Execute Feasibility Spikes**:
   - Run `python detector-service/spike/test_cosmos_reason_multiview.py`
   - Run `python detector-service/spike/test_sam3_seedbags.py`
   - Run `python detector-service/spike/test_target_isolation.py`
3. **Proceed to Phase 1**:
   - Purge deprecated RF-DETR/OWLv2 scripts and build the production container image.
