import { afterEach, describe, expect, it, vi } from 'vitest';
import { estimateFromFaces, PALLET_FACE_SLOTS } from './palletVision';

// prepareForVision needs canvas/createImageBitmap, which don't exist here; it
// catches and returns the original blob, so these exercise the request/vote logic.

function faces(n = 4) {
  return PALLET_FACE_SLOTS.slice(0, n).map((slotKey) => ({
    slotKey,
    blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }),
  }));
}

/** Queue one response per call, in order. `null` makes that call reject. */
function mockResponses(items: (Record<string, unknown> | null)[]) {
  let i = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const item = items[i++];
      if (item === null) return { ok: false, status: 502 } as Response;
      return { ok: true, status: 200, json: async () => item } as unknown as Response;
    })
  );
}

const face = (layers: number | null, extra: Record<string, unknown> = {}) => ({
  success: true,
  layers,
  topLayerFull: true,
  gaps: false,
  damage: false,
  estimatedBags: null,
  confidence: 0.95,
  rationale: 'x',
  modelVersion: 'rf-detr:pallet-bags',
  ...extra,
});

afterEach(() => vi.unstubAllGlobals());

describe('estimateFromFaces', () => {
  it('votes across the four faces and outvotes one bad reading', async () => {
    // The measured pallet-4 pattern.
    mockResponses([face(10), face(8), face(10), face(10)]);
    const est = await estimateFromFaces(faces());
    expect(est.consensus.value).toBe(10);
    expect(est.consensus.votes).toBe(3);
    expect(est.consensus.total).toBe(4);
    expect(est.consensus.tied).toBe(false);
  });

  it('reports a genuine split as tied instead of picking for the inspector', async () => {
    mockResponses([face(8), face(10), face(10), face(8)]);
    const est = await estimateFromFaces(faces());
    expect(est.consensus.tied).toBe(true);
  });

  it('keeps voting when one face request fails', async () => {
    mockResponses([face(10), null, face(10), face(8)]);
    const est = await estimateFromFaces(faces());
    expect(est.consensus.value).toBe(10);
    expect(est.consensus.total).toBe(3); // the failure contributes no vote
    const failed = est.readings.find((r) => r.error);
    expect(failed?.layers).toBeNull();
    expect(est.readings).toHaveLength(4); // still reported, so the UI can show it
  });

  it('returns no opinion when every face fails, rather than a wrong number', async () => {
    mockResponses([null, null, null, null]);
    const est = await estimateFromFaces(faces());
    expect(est.consensus.value).toBeNull();
    expect(est.readings.every((r) => r.error)).toBe(true);
  });

  it('does not report a clean pallet when nothing was actually read', async () => {
    // topLayerFull must not default to "fine" on a total failure — that would
    // silently assert the top course is complete when no face was inspected.
    mockResponses([null, null, null, null]);
    const est = await estimateFromFaces(faces());
    expect(est.gaps).toBe(false);
    expect(est.damage).toBe(false);
    expect(est.consensus.value).toBeNull(); // the signal the caller must check
  });

  it('raises an anomaly seen on any single face', async () => {
    // Damage on one side is still damage, even if three faces look fine.
    mockResponses([face(10), face(10, { damage: true }), face(10), face(10)]);
    const est = await estimateFromFaces(faces());
    expect(est.damage).toBe(true);
    expect(est.gaps).toBe(false);
  });

  it('treats a short top course on one face as short overall', async () => {
    mockResponses([face(10), face(10), face(10, { topLayerFull: false }), face(10)]);
    const est = await estimateFromFaces(faces());
    expect(est.topLayerFull).toBe(false);
  });

  it('ignores a null layer count without dropping the face from the report', async () => {
    mockResponses([face(null), face(10), face(10), face(10)]);
    const est = await estimateFromFaces(faces());
    expect(est.consensus.total).toBe(3);
    expect(est.consensus.value).toBe(10);
    expect(est.readings).toHaveLength(4);
  });

  it('carries the model version through for the audit trail', async () => {
    mockResponses([face(10), face(10), face(10), face(10)]);
    const est = await estimateFromFaces(faces());
    expect(est.modelVersion).toBe('rf-detr:pallet-bags');
  });

  it('works with fewer than four faces', async () => {
    mockResponses([face(10), face(10), face(8)]);
    const est = await estimateFromFaces(faces(3));
    expect(est.consensus.value).toBe(10);
    expect(est.readings).toHaveLength(3);
  });
});
