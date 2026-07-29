# Cosmos3 Nano Reasoner — measured on real GXO pallets

Run 2026-07-29 on an RTX PRO 6000 Blackwell (96 GiB) via `nvcr.io/nim/nvidia/cosmos3-reasoner`
(`NIM_MODEL_SIZE=nano`, vLLM 0.14.1). 23 photos from the `Bags_Phots` set, downscaled
to a 1024px long edge (~150 KB), using the **byte-identical production prompt**.

Reproduce with [`eval.py`](eval.py).

## Layer count, all faces

Ground truth: the SKU label gives the pallet quantity, and 60 bags ÷ 6 per layer = **10
layers**, which matches the photos.

| Pallet | Label | F1 | F2 | F3 | F4 | Vote |
|---|---|---|---|---|---|---|
| 2 | 60 | 10 | 10 | 10 | 8 | **10** ✓ |
| 3 | 60 | 10 | 8 | 10 | 10 | **10** ✓ |
| 4 | 60 | 10 | 8 | 10 | 10 | **10** ✓ |
| 5 | 60 | 10 | 10 | 9 | 12 | **10** ✓ |
| 6 | 60 | 8 | 10 | 10 | 8 | **tie** |
| 7 | 50 | 10 | 7 | 8 | — | unresolved |

- **Single face: ~65% exact (13/20), never off by more than 2.**
- **Voting across a pallet's four faces: 4 of 5 sixty-bag pallets correct**, one 2–2 tie.

## What works

**Latency: 1.2–1.9s per image.** Comfortably inside the 45s Static Web Apps gateway
cutoff, with room for multi-sampling. The earlier L4 concern is moot on this card.

**Parsing: 100%.** Every reply extracted cleanly. This only holds because the reasoner
emits `<think>…</think>` (the NIM reports `thinking_start_str`/`thinking_stop_str`, and
`reasoning_parser` is empty, so the tags reach the content) and `extractJsonObject`
strips them. The original first-brace parser would have failed on every response.

**The reasoning is genuinely on-task** — it describes bag branding, plastic wrap, wooden
pallets, and layer seams accurately. Errors are miscounts, not misunderstandings.

## What does not work

**`estimatedBags` is noise.** Returned 10, 100, 10, 12, 100, 8, 100, 64, 42 for pallets
holding 60. Sometimes it just echoes `layers`. Ignore this field; do not show it.

**`confidence` is uninformative.** Pinned at 0.95–1.0 including on wrong answers —
Pallet6.1 reported 8 layers with confidence **1.0**. It never expresses doubt, so it
cannot gate anything.

**Not deterministic despite `temperature: 0`.** Pallet3.1 returned 12 on one run and 10
on the next (vLLM continuous batching). Any single observation is weak evidence — which
is why `eval.py` supports `--samples`.

## Reading this fairly

The product treats the layer count as a **suggestion the verifier confirms**, and
`layers × bagsPerLayer` as the real total. At ~65% exact and always within ±2, the model
is a useful pre-fill for that flow. It is **not** an automated count and should not be
presented as one.

## Next, in value order

1. **Vote across the pallet's faces.** Free — those photos are already captured.
2. **Persist the suggestion alongside the verifier's correction.** Today the suggestion
   overwrites `layerCount` and is then lost, so there is no accuracy metric and no
   training data. This is the prerequisite for every improvement below.
3. **Drop `estimatedBags` from the prompt** — misleading, and it costs tokens.
4. **Multi-sample and take the median.** At 1.5s a call, 3 samples still fits the budget.
5. **Prompt with the domain rule.** The 8-vs-10 error pattern suggests it misses courses
   presenting bag *ends* rather than printed faces. Say so explicitly and re-measure.
6. **Fine-tune** once the confirm loop has produced a few hundred labelled examples.
