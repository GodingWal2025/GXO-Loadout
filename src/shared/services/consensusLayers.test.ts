import { describe, expect, it } from 'vitest';
import { consensusLayers } from './palletVision';

// The sample arrays below are the real measured outputs from Cosmos3 Nano Reasoner
// on the Bags_Phots pallets — see prior pallet-photo evaluation. The 60-bag pallets are
// 10 layers of 6, so 10 is ground truth for pallets 2-6.

describe('consensusLayers', () => {
  it('has no opinion with no samples', () => {
    expect(consensusLayers([])).toEqual({ value: null, votes: 0, total: 0, tied: false });
  });

  it('passes a single sample through, and does not claim agreement', () => {
    expect(consensusLayers([10])).toEqual({ value: 10, votes: 1, total: 1, tied: false });
  });

  it('recovers the right answer from the measured pallet 2/3/4 faces', () => {
    // 10,10,10,8 and 10,8,10,10 — one bad face outvoted.
    expect(consensusLayers([10, 10, 10, 8]).value).toBe(10);
    expect(consensusLayers([10, 8, 10, 10]).value).toBe(10);
  });

  it('recovers pallet 5, where the two wrong faces disagreed with each other', () => {
    // 10,10,9,12 — 9 and 12 are both wrong but split, so 10 still wins.
    const c = consensusLayers([10, 10, 9, 12]);
    expect(c.value).toBe(10);
    expect(c.votes).toBe(2);
    expect(c.tied).toBe(false);
  });

  it('flags pallet 6 as tied rather than inventing an answer', () => {
    // 8,10,10,8 — a genuine 2-2 split. The human must decide.
    const c = consensusLayers([8, 10, 10, 8]);
    expect(c.tied).toBe(true);
    expect(c.votes).toBe(2);
    expect(c.total).toBe(4);
  });

  it('returns an observed value, never an average', () => {
    // A median of [8,8,10,10] is 9 — a count no face reported. Must not happen.
    expect([8, 10]).toContain(consensusLayers([8, 8, 10, 10]).value);
    expect(consensusLayers([7, 8, 10]).value).not.toBe(8.33);
  });

  it('breaks ties deterministically, not by insertion order', () => {
    expect(consensusLayers([8, 10]).value).toBe(consensusLayers([10, 8]).value);
    expect(consensusLayers([8, 8, 12, 12]).value).toBe(consensusLayers([12, 12, 8, 8]).value);
  });

  it('ignores junk without letting it skew the vote', () => {
    expect(consensusLayers([10, 0, 10, -3, 10]).value).toBe(10);
    expect(consensusLayers([10, 10.5, 10]).total).toBe(2);
    expect(consensusLayers([0, -1]).value).toBeNull();
  });

  it('reports unanimity as full agreement', () => {
    const c = consensusLayers([10, 10, 10, 10]);
    expect(c).toEqual({ value: 10, votes: 4, total: 4, tied: false });
  });

  it('lets a later majority override an early wrong reading', () => {
    // Faces arrive one press at a time; the first can be wrong.
    expect(consensusLayers([8]).value).toBe(8);
    expect(consensusLayers([8, 10]).tied).toBe(true);
    expect(consensusLayers([8, 10, 10]).value).toBe(10);
  });
});
