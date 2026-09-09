# Four-face bag counting: rollout plan

Prepared September 9, 2026. Status: proposed implementation plan; no production changes or model training performed by this review.

## Decision

Build an assisted counter using FRONT, RIGHT, BACK, and LEFT photos. No top photo is required. Identify visible sewn bag flaps, restrict each image to its assigned physical face, sum eligible face counts, and have the operator confirm or correct the result. Show a visible-only subtotal when the evidence cannot establish a complete pallet total.

Keep Cosmos + SAM 3 as the reference pipeline. Benchmark a small supervised detector with the same target-face isolation before choosing the production model. Use SAM 3 for label proposals where it saves human time. Do not commit to a continuously running two-GPU deployment before measured accuracy, utilization, and cost justify it.

This plan supersedes the hardware-first sequence in BAG_COUNT_MODEL_PLAN.md for this rollout. That older plan reports earlier RF-DETR/OWLv2 failures from background clutter. Retrieve those results and checkpoints if available; a small-model retry must use reviewed domain labels and matched face isolation, not simply repeat an unsuccessful zero-shot experiment.

## Verified starting point

Read-only inspection of the live console and its training manifest endpoint found:

| Item | Observed |
|---|---:|
| Uploaded pallet records | 145 |
| Side photos | 580; all records have all four side roles |
| Identification close-ups | 163 |
| Total photos in manifests | 743 |
| Recorded bags | 6,626 |
| Records with partialBags above zero | 46 |
| Totals disagreeing with entered layer arithmetic | 0 |
| Records with partialBags at least bagsPerLayer | 15 |
| Records containing 60 bags | 74, approximately 51% |
| Collector device identifiers | 5 |
| Explicit quality=good / quality unspecified | 21 / 124 |
| Records without entered SKU / physical pallet ID | 145 / 145 |
| Collection dates | August 5–25, 2026 |

The displayed Review screen flags 46 records and shows “missing top photo” on partial pallets. Treat these as legacy workflow warnings until individual audit proves a real defect. The 15 unusual partial-count entries require clarification of field meaning, not automatic normalization. Matching arithmetic does not prove the physical total was independently counted.

The live Label tab offers manual boxes and COCO JSON export. The inspected export uses empty segmentation arrays; the newer SAM 3 preparation/validation path expects a grouped master export, target regions, and reviewed masks. Uploaded photos are not equivalent to completed training annotations. This review did not establish the number of previously saved annotations or inspect all 743 image files for readability. A fresh browser showing zero loaded labels is not evidence that other collectors have no labels.

## Phase 1 — Establish trustworthy data and counting rules

Target: days 1–3. Owners: application engineer and warehouse verifier.

1. Preserve an immutable manifest snapshot plus a complete photo backup and checksum inventory. Keep originals in Azure with a tested recovery path; store dataset versions and hashes in the repository rather than repeatedly committing photo collections.
2. Inventory any existing label exports and annotations before migrating the console. Add persistent annotation save/load, review status, export version, and clear saved/sync status. Verify reload and a second session retain the same labels.
3. Remove top-photo requirements and stale TOP guidance from the deployed console, audit, labeling import, and export paths. Keep historical partial-count metadata without making it an inference input. Verify deployment parity and invalidate stale cached assets where applicable.
4. Use the existing sample ID as the record key. Add a way to group repeat photographs of the same physical pallet across submissions. Check exact and near-duplicate photos before splitting; blank physical pallet IDs make this essential.
5. Define separate states: unreviewed, reviewed, unresolved, and excluded, with reasons. An unspecified historical quality flag stays unreviewed until inspected.
6. Audit all totals, all 15 unusual partial fields, duplicate candidates, and bad/missing image files. Do not change actual totals just to make metadata appear conventional. Record verifier and verification method.
7. Select 20 representative development pallets: ordinary full stacks, short stacks, partial/mixed stacks, wrap glare, folded flaps, and background clutter. Have two people independently count visible flaps per assigned face and compare the sum with an independently verified physical total.

Counting contract: one identifiable sewn end represents one bag only after the warehouse audit validates that relationship for the included stack types. Count only the assigned face; exclude adjacent faces and background pallets. Do not add close-up photos to the total. If some bags expose no identifiable flap, or ownership across views is unresolved, the four-side images cannot substantiate an exact total. Record that limitation and require manual confirmation; do not infer missing bags from the expected shipment quantity.

Exit: counting contract approved for supported stack types; audit table produced; original data preserved; no top-photo requirement; one saved annotation survives reload and exports successfully.

## Phase 2 — Label the existing collection and freeze the benchmark

Target: week 1–2, depending on reviewer availability. Owners: labeler, warehouse verifier, engineer.

Start with the existing 145 pallets. More collection is targeted at failures rather than being a prerequisite to the first experiment.

Annotation specification:

- One bag_flap box per distinguishable sewn end on the assigned face. Capture a face polygon or verified crop excluding neighboring faces and pallets.
- Keep per-face human count and pallet actual total separately. Never duplicate the whole pallet count as each photo's target.
- Record visibility, blur, glare, clipping, obstruction, uncertain instances, physical pallet group, face role, image hash, and reviewer status.
- A reviewed zero-flap face is valid. A completely unreadable face is unresolved, not a zero-count negative. Export must distinguish these cases from unlabeled images.
- Keep accepted SAM masks when available. Boxes are sufficient for the first small detection model; do not manufacture segmentation ground truth from rectangles. Maintain separate validation requirements for box and mask datasets.

Use the 20 development pallets for annotation-rule calibration and proposal tuning. Time the first 40 images, then estimate the remaining labor. Have a second reviewer check at least 20% of development annotations and all ambiguous examples. Independently verify every final test pallet total and face labels.

Subject to duplicate removal and coverage, allocate approximately 95 train, 25 validation, and 25 locked test pallets (380/100/100 side images). The 20 development pallets belong only in training. Keep all views and repeat sessions of one physical pallet together. Spread rare stack counts and difficult conditions across splits where possible; add a later collection period as a separate prospective test.

The 25-pallet test is an initial comparison, not evidence of 99% reliability. Do not select thresholds on it or repeatedly inspect it to tune the model. The 60-bag majority demands separate full/partial and count-range reporting.

Exit: versioned dataset, reviewed labels, zero split leakage, import/export round trip, and a frozen test manifest. Any exclusions appear in the coverage report.

## Phase 3 — Run a bounded model comparison

Target: week 2–3. Owner: model engineer.

Compare three configurations with identical development/validation splits:

| Configuration | Purpose |
|---|---|
| Current Cosmos + SAM 3 pipeline | Establish reference accuracy, failure modes, latency, and billed cost |
| RF-DETR Nano or Small with the same face isolation | Test whether a supervised smaller counter preserves accuracy |
| Winning small counter with operator-confirmed crop or lightweight face locator | Measure savings from removing routine Cosmos inference |

Evaluate raw face crops against rectification on validation data. Prior failures attributed to clutter must be retested under equal target isolation. Save detector checkpoints, configuration, dataset version, preprocessing, and all predictions. Limit the initial search to a few recorded experiments; expand only for an identified failure mode.

Test actual warehouse-resolution photos against the current 1024px/~128KB upload preparation. Tiny flaps can disappear during compression. Select the lowest upload size that retains count performance; train with the same production preprocessing. Test safe retry behavior, startup latency, and the existing request deadline.

Select on exact per-face and per-pallet counts, not visual attractiveness of outlines or detector benchmark scores. Keep SAM 3 if it materially outperforms the smaller model at acceptable total cost. DINOv3 density/count heads are a later experiment only if localized detectors hit a demonstrated limitation; they add implementation and calibration work.

Exit: reproducible scorecard, a model selection decision, and measured cost per four-photo pallet. If no configuration is useful, produce a failure-driven collection list rather than scale GPU spending.

## Phase 4 — Integrate an honest assisted workflow

Target: week 3–4. Owner: application engineer.

Flow: capture four faces → quality/face checks → count visible flaps → show numbered overlays and four subtotals → display eligible total or incomplete subtotal → operator confirms/corrects → store the confirmed result and model evidence separately.

Required changes:

1. Treat a complete count as requiring four distinct valid assigned faces. A three-face result is incomplete. Do not use agreement in layer estimates as the main eligibility gate for direct flap totals.
2. Prevent adjacent-face and repeated-photo double counting. Unsafe geometry must require a corrected crop, recapture, or review; a padded raw fallback may include a second face and must not silently produce a trusted total.
3. Replace hard-coded “top full,” “no gaps,” and “no damage” assertions with unknown/not assessed where there is no measured evidence. Remove unsupported high percentage confidence. Average object detection scores are not the probability the pallet total is correct.
4. Return model count, per-face counts, review reasons, evidence completeness, model/dataset versions, and timings. Keep human-confirmed count and corrections in distinct audit fields.
5. Retain manual counting throughout. Failed/offline inference must not block loadout or convert missing results to zero.
6. Cache results by image hash plus model/preprocessing version to avoid duplicate inference charges. Bound retries, queue depth, and concurrency. Batch the four images within one job when supported.
7. If measured cold starts exceed the gateway deadline, use submit-job/status retrieval or keep one worker warm during active shifts. Choose after measuring traffic; no automatic all-day warm allocation.
8. Save corrected detections as proposed training labels requiring review. Never automatically retrain and promote a production model from operator edits.

Code touchpoints: public/bag-count-console.html; api/src/training.ts; src/features/bag-labeling/*; detector-service/prepare_dataset.py and validate_dataset.py; detector-service/pipeline.py and app.py; detector-service/eval.py; src/shared/services/palletVision.ts; the counting UI in src/routes/ScanPalletRoute.tsx; API proxy routes in api/src/index.ts.

Exit: tested full/partial/zero-visible-face/duplicate-face/timeout/offline flows; counts and overlays remain aligned after rotation and crop transforms; manual fallback works; previous model can be restored through configuration.

## Phase 5 — Shadow evaluation and assisted pilot

Target: weeks 4–6, extended if fresh pallet throughput is low. Owners: warehouse lead and engineer.

Run on fresh pallets without showing the prediction until the independent manual count is recorded. This avoids human counts being influenced by the model. Start with 100–200 new pallets across shifts, devices, and supported stack types. Compare an initial subset with a second verifier. Then enable a limited assisted pilot if it improves the work.

Proposed pilot gates, to be evaluated rather than assumed:

| Metric | Target |
|---|---|
| Exact pallet total on eligible complete cases | At least 95%; publish numerator, denominator, and uncertainty |
| Coverage | At least 80% of in-scope submitted pallets produce eligible complete suggestions |
| Eligible partial-stack exact accuracy | Report separately; retain manual-only status if weak |
| Material counting errors | Report undercounts, overcounts, and errors greater than one bag separately |
| Warm end-to-end response time after upload | 95th percentile at or below 10 seconds |
| Incremental billed inference cost | Target below $0.02 per submitted four-face pallet, including retries/startup allocation |
| Workflow value | Reduce median total inspection time by at least 20% against the current manual workflow |
| Human verification | Required for every shipped pallet during the pilot |

Always report all submissions, incomplete cases, exclusions, and corrections. A system that rejects nearly everything must not look accurate through selective reporting. Include localization, preprocessing, all four images, and reconciliation in end-to-end evaluation; the existing supplied-crop evaluator is insufficient by itself.

Automatic acceptance is a separate future milestone. For scale intuition, zero errors in 299 independent eligible accepted cases gives a one-sided 95% binomial upper error bound just under 1%; zero in 25 only bounds it near 11.3%. This calculation assumes representative independent samples and does not establish performance on new SKUs, sites, or conditions. Keep human confirmation unless a separate operational standard is met.

Exit: signed pilot scorecard, observed time savings, cost ledger, supported-case list, rollback check, and named operational owner.

## Budget and operating model

Planning allowances, not vendor quotes or purchases:

| Work | Initial allowance |
|---|---:|
| Dataset audit, annotation, verification | Roughly 30–60 staff hours; replace after timing the first 40 images |
| Engineering and model work | Roughly 80–160 hours; depends on annotation persistence and deployment gaps |
| First benchmark/training compute | $50–$150 spending cap |
| Incremental monthly pilot infrastructure | $50–$150 planning allowance |

Labor dominates the first release. Existing cloud costs, paid enterprise plans, and additional data collection labor are separate. The caps are proposed budgets, not authorization to purchase capacity.

For a scale-to-zero small counter, Modal lists L4 GPU time at $0.000222/second as checked September 9, 2026. At 10 billed GPU-seconds per pallet, 10,000 pallets use $22.20 GPU compute; at 30 seconds, $66.60. CPU, RAM, storage, startup/warm time, plan charges, and any additional model calls must be added. A continuously allocated L4 at the same base rate is about $583 for 730 hours. These scenarios are not benchmarks or an assurance that Cosmos plus SAM 3 fits on one L4.

Use existing Azure capture/storage/API infrastructure. Start with short-lived GPU jobs; record the cost of both reference models separately. Set provider budget alerts and worker limits. Later compare a shift-scheduled worker or on-site machine using actual utilization, maintenance, connectivity, and response-time needs.

Monthly operating review: cost per confirmed count, correction/review rate, latency, failures by SKU/device/shift, and label backlog. Roll back on a material regression or incorrect evidence-completeness behavior. New models first run against the frozen benchmark and fresh shadow cases. Preserve the previous checkpoint and compatible service image.

## First implementation backlog

| Priority | Deliverable | Done when |
|---|---|---|
| P0 | Snapshot and audit | Every record/photo accounted for; duplicate and unresolved lists recorded |
| P0 | Four-side console cleanup | No missing-top warning; deployed and source workflows agree |
| P0 | Persistent annotation/export bridge | Reviewed box labels survive reload and load into training; masks validated separately |
| P0 | 20-pallet visibility audit | Supported one-flap-per-bag cases identified; exceptions recorded |
| P1 | Frozen dataset | Group-isolated train/validation/test with verifiable provenance |
| P1 | Full-pipeline scorecard | Current model and one small model compared under matched isolation |
| P1 | Assisted-count contract/UI | Four-face evidence gate, corrections, unknown conditions, fallback |
| P2 | Fresh shadow pilot | Accuracy, coverage, time, and spend measured against manual work |

Immediate next work is the audit and annotation/export bridge, followed by the 20-pallet counting-contract check. The existing 145 records support starting now; deployment choice follows measured results.

## Sources and limits

- [Live bag-count console](https://white-meadow-0dc31e50f.7.azurestaticapps.net/bag-count-console.html), Review and Label screens, inspected September 9, 2026.
- [Live training manifests](https://white-meadow-0dc31e50f.7.azurestaticapps.net/api/training/samples), read-only aggregate audit on the same date.
- Local service, console, dataset preparation, evaluation code, and existing model/rectification plans inspected on the same date. No new model accuracy measurements were performed.
- [Modal pricing](https://modal.com/pricing), L4 base compute rate checked during this conversation.
- [RF-DETR official repository](https://github.com/roboflow/rf-detr), candidate model family; verify the selected checkpoint's license and pin its version before use.
