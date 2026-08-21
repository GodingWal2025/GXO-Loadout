import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assessPalletFaces,
  bestBagTotal,
  physicalIssues,
  type PalletAssessment,
} from './palletVision';

const base: PalletAssessment = {
  success: true,
  faces: [],
  visibleBagTotal: null,
  gaps: false,
  damage: false,
  topLayerFull: true,
  confidence: 0.9,
  rationale: null,
};

describe('bestBagTotal', () => {
  it('prefers located boxes over the model self-reported tally', () => {
    // Enumeration is the weak spot; a count of things it actually located is the
    // better number, and the caller is told which it got.
    expect(
      bestBagTotal({ ...base, visibleBagTotal: 48, visibleBagTotalFromBoxes: 60 })
    ).toEqual({ total: 60, source: 'boxes' });
  });

  it('falls back to the tally when boxes were not requested', () => {
    expect(bestBagTotal({ ...base, visibleBagTotal: 60 })).toEqual({
      total: 60,
      source: 'tally',
    });
  });

  it('does not treat zero boxes as a valid total', () => {
    // 0 located means it found nothing, not that the pallet holds no bags.
    expect(
      bestBagTotal({ ...base, visibleBagTotal: 60, visibleBagTotalFromBoxes: 0 })
    ).toEqual({ total: 60, source: 'tally' });
  });

  it('reports none rather than a number when there is nothing to report', () => {
    expect(bestBagTotal(base)).toEqual({ total: null, source: 'none' });
    expect(bestBagTotal({ ...base, visibleBagTotal: 0 })).toEqual({
      total: null,
      source: 'none',
    });
  });
});

describe('physicalIssues', () => {
  it('is empty for a sound load', () => {
    expect(
      physicalIssues({
        ...base,
        leaning: false,
        overhang: false,
        wrapIntact: true,
        loadStable: true,
      })
    ).toEqual([]);
  });

  it('does not invent issues from unanswered fields', () => {
    // null means the model did not say — that must not read as a problem.
    expect(
      physicalIssues({
        ...base,
        leaning: null,
        overhang: null,
        wrapIntact: null,
        loadStable: null,
      })
    ).toEqual([]);
  });

  it('flags torn wrap on wrapIntact false, not true', () => {
    expect(physicalIssues({ ...base, wrapIntact: false })).toContain('wrap damaged');
    expect(physicalIssues({ ...base, wrapIntact: true })).not.toContain('wrap damaged');
  });

  it('collects every distinct problem', () => {
    const issues = physicalIssues({
      ...base,
      leaning: true,
      overhang: true,
      wrapIntact: false,
      loadStable: false,
      damage: true,
      gaps: true,
      topLayerFull: false,
    });
    expect(issues).toHaveLength(7);
    expect(issues).toContain('leaning');
    expect(issues).toContain('load may shift');
  });
});

describe('assessPalletFaces', () => {
  afterEach(() => vi.unstubAllGlobals());

  const faces = () =>
    ['FRONT_VIEW', 'SIDE_VIEW_1'].map((slotKey) => ({
      slotKey,
      blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }),
    }));

  it('sends one request containing every face', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ...base, faces: [], visibleBagTotal: 60 }),
    })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    await assessPalletFaces(faces());

    expect(fetchMock).toHaveBeenCalledTimes(1); // not one call per face
    const body = JSON.parse((fetchMock as any).mock.calls[0][1].body);
    expect(body.images).toHaveLength(2);
    expect(body.images[0].slotKey).toBe('FRONT_VIEW');
    expect(body.images[0].dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('passes capability toggles through so each can be isolated', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => base,
    })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    await assessPalletFaces(faces(), { wantBoxes: false, wantCondition: false });

    const body = JSON.parse((fetchMock as any).mock.calls[0][1].body);
    expect(body.wantBoxes).toBe(false);
    expect(body.wantCondition).toBe(false);
    expect(body.wantInterior).toBe(true); // unspecified stays on
  });

  it('throws on a non-2xx so the caller can require manual review', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 501 }) as Response)
    );
    await expect(assessPalletFaces(faces())).rejects.toThrow(/501/);
  });
});
