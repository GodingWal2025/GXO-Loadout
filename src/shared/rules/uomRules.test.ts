import { describe, expect, it } from 'vitest';
import {
  parseSpSize,
  parsePackInfo,
  bagsPerUnit,
  shouldExplode,
  explodePicklistLine,
  explodePicklistLines,
} from './uomRules';
import { mlSuggestable, emptySuggestable } from '../types/inspection';
import type { PicklistLineItemEntry, Uom } from '../types/inspection';

function line(uom: Uom, qty: number | null, description: string | null = null): PicklistLineItemEntry {
  return {
    id: `id-${uom}-${qty}`,
    batchCode: emptySuggestable<string>(),
    sku: mlSuggestable('91007301'),
    description: mlSuggestable(description),
    expectedQuantity: mlSuggestable(qty),
    uom,
    actualQuantity: 0,
    fulfilled: false,
  };
}

describe('parseSpSize', () => {
  it('reads the USP token from a material description', () => {
    expect(parseSpSize('C.CL.201-40VT4PRIB.SF2.40USP.UB.US')).toBe(40);
    expect(parseSpSize('C.CL.199-45VT2PRIB.SCS.45USP.G7.US')).toBe(45);
    expect(parseSpSize('B.AS.AG18XF1.SD3.50USP.X.US')).toBe(50);
  });

  it('handles the SCUSP variant and the placard SP-form', () => {
    expect(parseSpSize('B.AS.AG18XF1.SD3.40SCUSP.X.US')).toBe(40);
    expect(parseSpSize('LABLE CORN SP50 PLACARD DK/AS LOGO US')).toBe(50);
  });

  it('returns null when there is no decipherable size', () => {
    expect(parseSpSize('C.CL.195-85DGVT2PRIB.SC8.80M.G7.US')).toBeNull();
    expect(parseSpSize(null)).toBeNull();
    expect(parseSpSize('')).toBeNull();
  });

  it('does not treat a Minibulk (UMB) token as a SeedPak', () => {
    expect(parseSpSize('B.AS.AG18XF1.SD3.40SCUMB.X.US')).toBeNull();
  });
});

describe('parsePackInfo', () => {
  it('distinguishes SeedPak (USP) from Minibulk (UMB)', () => {
    expect(parsePackInfo('C.CL.201-40VT4PRIB.SF2.40USP.UB.US')).toEqual({ size: 40, kind: 'SP' });
    expect(parsePackInfo('B.AS.AG18XF1.SD3.40SCUMB.X.US')).toEqual({ size: 40, kind: 'MB' });
    expect(parsePackInfo('B.AS.AG18XF1.SD3.45SCUMB.X.US')).toEqual({ size: 45, kind: 'MB' });
  });

  it('is null when no tote token is present', () => {
    expect(parsePackInfo('C.CL.195-85DGVT2PRIB.SC8.80M.G7.US')).toBeNull();
    expect(parsePackInfo(null)).toBeNull();
  });
});

describe('bagsPerUnit', () => {
  it('is 1 for bags, 60 for a pallet', () => {
    expect(bagsPerUnit('BG', null)).toBe(1);
    expect(bagsPerUnit('BAG', null)).toBe(1);
    expect(bagsPerUnit('PL', null)).toBe(60);
  });

  it('is the tote size for SeedPaks and Minibulks, null when undecipherable', () => {
    expect(bagsPerUnit('SP', 'x.45USP.y')).toBe(45);
    expect(bagsPerUnit('MB', 'x.40SCUMB.y')).toBe(40);
    expect(bagsPerUnit('SP', 'no-size-here')).toBeNull();
  });

  it('is null for C62 and PCE', () => {
    expect(bagsPerUnit('C62', 'anything')).toBeNull();
    expect(bagsPerUnit('PCE', 'anything')).toBeNull();
  });
});

describe('explodePicklistLine', () => {
  it('splits an SP line of N into N one-SP lines', () => {
    const out = explodePicklistLine(line('SP', 4, 'x.40USP.y'));
    expect(out).toHaveLength(4);
    expect(out.every((l) => l.uom === 'SP')).toBe(true);
    expect(out.every((l) => l.expectedQuantity.value === 1)).toBe(true);
    // Description (and thus size) is preserved on every split line.
    expect(out.every((l) => parseSpSize(l.description.value) === 40)).toBe(true);
  });

  it('keeps the original id on the first split line and makes the rest unique', () => {
    const src = line('SP', 3, 'x.50USP.y');
    const out = explodePicklistLine(src);
    expect(out[0].id).toBe(src.id);
    const ids = new Set(out.map((l) => l.id));
    expect(ids.size).toBe(3);
  });

  it('does not explode a single SP, a zero, or a null quantity', () => {
    expect(explodePicklistLine(line('SP', 1))).toHaveLength(1);
    expect(explodePicklistLine(line('SP', 0))).toHaveLength(1);
    expect(explodePicklistLine(line('SP', null))).toHaveLength(1);
  });

  it('explodes MB (minibulk) lines the same way as SP', () => {
    expect(shouldExplode('MB')).toBe(true);
    const out = explodePicklistLine(line('MB', 3, 'x.45SCUMB.y'));
    expect(out).toHaveLength(3);
    expect(out.every((l) => l.uom === 'MB' && l.expectedQuantity.value === 1)).toBe(true);
  });

  it('never explodes non-tote UOMs', () => {
    expect(shouldExplode('PL')).toBe(false);
    expect(explodePicklistLine(line('PL', 5))).toHaveLength(1);
    expect(explodePicklistLine(line('BG', 18))).toHaveLength(1);
    expect(explodePicklistLine(line('C62', 3))).toHaveLength(1);
  });
});

describe('explodePicklistLines', () => {
  it('explodes SP lines while passing others through, preserving order', () => {
    const out = explodePicklistLines([line('BG', 18), line('SP', 2, 'x.40USP.y'), line('PL', 1)]);
    expect(out.map((l) => l.uom)).toEqual(['BG', 'SP', 'SP', 'PL']);
  });
});
