# Pallet-face rectification rollout

The production counting boundary is now:

`Cosmos target + face geometry → OpenCV canonical face → counter → source-coordinate results`

Cosmos owns semantic selection: target pallet, primary physical face, orientation,
visibility, and confidence. OpenCV owns the deterministic homography. The counter
only sees either the canonical face or the legacy padded pallet crop; it does not
decide which pallet or face is primary.

## Safety and fallback

Rectification requires a resolved target, recognized primary face, valid quad,
quad corners near the target pallet box, sufficient visibility and geometry
confidence, acceptable skew, and `safeToRectify=true`. Any failed gate or OpenCV
error falls back to the former raw ROI counting path. A geometry failure does not
make an otherwise resolved target ambiguous.

## Rollout modes

- `PALLET_RECTIFICATION_MODE=off`: raw ROI control path.
- `PALLET_RECTIFICATION_MODE=prefer` (default): canonical input when safe, raw fallback.
- `PALLET_RECTIFICATION_MODE=shadow`: canonical result plus a second raw inference.
  The response reports both counts, their delta, and per-pass latency under
  `abComparison`. Shadow mode roughly doubles counter inference load.

Every count response identifies `countingInput` and includes `geometry`,
`rectification`, and `abComparison`. Canonical masks are inverse-warped back to
the original image so existing overlay clients remain compatible.

## Future counter boundary

`PalletFaceCounter.predict()` returns a model-neutral `CounterPrediction`. SAM3
currently populates instance masks. A DINOv3 specialist can populate density,
bag centers, count class, consensus count, and confidence without changing the
VLM prompt, geometry gates, rectification, fallback, or service routes.
