import { describe, expect, it } from 'vitest';
import { recomputeTallies } from './useInspection';
import { emptySuggestable, mlSuggestable } from '../types/inspection';
import type { Inspection, PicklistLineItemEntry, Uom } from '../types/inspection';

function line(batch: string, uom: Uom, qty: number, description: string | null = null) {
  return {
    id: `li-${batch}-${qty}-${Math.random()}`,
    batchCode: mlSuggestable(batch),
    sku: mlSuggestable('91876757'),
    description: mlSuggestable(description),
    expectedQuantity: mlSuggestable(qty),
    uom,
    actualQuantity: 0,
    fulfilled: false,
  } as PicklistLineItemEntry;
}

function section(batch: string, bags: number) {
  return {
    id: `bs-${batch}-${bags}`,
    batchCode: mlSuggestable(batch),
    productName: emptySuggestable<string>(),
    expectedBagCount: 0,
    actualBagCount: mlSuggestable(bags),
  };
}

/** Minimal state — recomputeTallies only reads lineItems and pallet batchSections. */
function state(lineItems: PicklistLineItemEntry[], sections: ReturnType<typeof section>[]) {
  return {
    picklist: { lineItems },
    pallets: [{ batchSections: sections }],
  } as unknown as Inspection;
}

const totalActual = (r: Inspection) =>
  r.picklist.lineItems.reduce((sum, li) => sum + li.actualQuantity, 0);

describe('recomputeTallies — one batch code across several picklist lines', () => {
  it('allocates a scanned pallet across the lines instead of crediting each in full', () => {
    // The reported bug: picklist needs 71 of P18GP43N8, split 60 + 11. Scanning
    // one 60-bag pallet used to read 60/60 "Complete" AND 60/11 "Over by 49",
    // with a header total of 120 for 60 physical bags.
    const result = recomputeTallies(
      state(
        [line('P18GP43N8', 'BG', 60), line('P18GP43N8', 'BG', 11)],
        [section('P18GP43N8', 60)]
      )
    );

    expect(result.picklist.lineItems.map((li) => li.actualQuantity)).toEqual([60, 0]);
    expect(result.picklist.lineItems.map((li) => li.fulfilled)).toEqual([true, false]);
    expect(totalActual(result)).toBe(60);
  });

  it('counts exploded SeedPak lines once each, not once per line', () => {
    // explodePicklistLines() emits one line per unit, all sharing a batch code.
    const lines = Array.from({ length: 4 }, () => line('P18S4LFMB', 'BG', 40));
    const result = recomputeTallies(state(lines, [section('P18S4LFMB', 80)]));

    expect(result.picklist.lineItems.map((li) => li.actualQuantity)).toEqual([40, 40, 0, 0]);
    expect(totalActual(result)).toBe(80);
  });

  it('lands an over-scan on the last line so it still surfaces as an overage', () => {
    const result = recomputeTallies(
      state(
        [line('P18GP43N8', 'BG', 60), line('P18GP43N8', 'BG', 11)],
        [section('P18GP43N8', 80)]
      )
    );

    expect(result.picklist.lineItems.map((li) => li.actualQuantity)).toEqual([60, 20]);
    expect(totalActual(result)).toBe(80);
  });

  it('sums bags across pallets before allocating', () => {
    const result = recomputeTallies(
      state(
        [line('P18GP43N8', 'BG', 60), line('P18GP43N8', 'BG', 11)],
        [section('P18GP43N8', 45), section('P18GP43N8', 20)]
      )
    );

    expect(result.picklist.lineItems.map((li) => li.actualQuantity)).toEqual([60, 5]);
    expect(totalActual(result)).toBe(65);
  });

  it('converts the expected side to bags when allocating (1 PL = 60 bags)', () => {
    const result = recomputeTallies(
      state(
        [line('P18GP43N8', 'PL', 1), line('P18GP43N8', 'BG', 11)],
        [section('P18GP43N8', 60)]
      )
    );

    // The PL line expects 60 bags, so it absorbs the whole pallet.
    expect(result.picklist.lineItems.map((li) => li.actualQuantity)).toEqual([60, 0]);
  });

  it('leaves distinct batch codes independent', () => {
    const result = recomputeTallies(
      state(
        [line('AAA', 'BG', 40), line('BBB', 'BG', 40)],
        [section('AAA', 40), section('BBB', 25)]
      )
    );

    expect(result.picklist.lineItems.map((li) => li.actualQuantity)).toEqual([40, 25]);
    expect(result.picklist.lineItems.map((li) => li.fulfilled)).toEqual([true, false]);
  });
});

// ============================================================
// Packaging SKU exclusion (outbound + OCR)
// ============================================================

function packagingLine(sku: string, uom: Uom, qty: number) {
  return {
    id: `li-pkg-${sku}-${Math.random()}`,
    batchCode: mlSuggestable(null),
    sku: mlSuggestable(sku),
    description: mlSuggestable('PACKAGING MATERIAL'),
    expectedQuantity: mlSuggestable(qty),
    uom,
    actualQuantity: 0,
    fulfilled: false,
  } as PicklistLineItemEntry;
}

function manualPackagingLine(sku: string, uom: Uom, qty: number) {
  return {
    id: `li-pkg-manual-${sku}-${Math.random()}`,
    batchCode: emptySuggestable<string>(),
    sku: { value: sku, source: 'manual' as const },
    description: { value: 'PACKAGING MATERIAL', source: 'manual' as const },
    expectedQuantity: { value: qty, source: 'manual' as const },
    uom,
    actualQuantity: 0,
    fulfilled: false,
  } as PicklistLineItemEntry;
}

/** State with inspection type — packaging exclusion depends on outbound + OCR. */
function typedState(
  type: 'outbound' | 'returns',
  lineItems: PicklistLineItemEntry[],
  sections: ReturnType<typeof section>[]
) {
  return {
    type,
    picklist: { lineItems },
    pallets: [{ batchSections: sections }],
  } as unknown as Inspection;
}

describe('recomputeTallies — packaging SKU exclusion', () => {
  it('marks packaging lines as fulfilled with 0 actual when outbound + OCR', () => {
    const result = recomputeTallies(
      typedState(
        'outbound',
        [line('P18GP43N8', 'BG', 60), packagingLine('87674223', 'BG', 2)],
        [section('P18GP43N8', 60)]
      )
    );

    // Product line should be fulfilled
    expect(result.picklist.lineItems[0].fulfilled).toBe(true);
    expect(result.picklist.lineItems[0].actualQuantity).toBe(60);
    // Packaging line should be excluded (fulfilled with 0 actual)
    expect(result.picklist.lineItems[1].fulfilled).toBe(true);
    expect(result.picklist.lineItems[1].actualQuantity).toBe(0);
  });

  it('does NOT exclude packaging when picklist has no OCR data', () => {
    const result = recomputeTallies(
      typedState(
        'outbound',
        [
          // Manual product line
          manualPackagingLine('91007244', 'BG', 60),
          // Manual packaging line
          manualPackagingLine('87674223', 'BG', 2),
        ],
        []
      )
    );

    // Without OCR, the packaging line should NOT be auto-fulfilled
    expect(result.picklist.lineItems[1].fulfilled).toBe(false);
    expect(result.picklist.lineItems[1].actualQuantity).toBe(0);
  });

  it('excludes all three packaging SKUs', () => {
    const result = recomputeTallies(
      typedState(
        'outbound',
        [
          line('BATCH1', 'BG', 40),
          packagingLine('87674223', 'BG', 1),
          packagingLine('9905613', 'BG', 3),
          packagingLine('87675793', 'BG', 5),
        ],
        [section('BATCH1', 40)]
      )
    );

    // Product fulfilled
    expect(result.picklist.lineItems[0].fulfilled).toBe(true);
    // All three packaging SKUs excluded
    expect(result.picklist.lineItems[1].fulfilled).toBe(true);
    expect(result.picklist.lineItems[1].actualQuantity).toBe(0);
    expect(result.picklist.lineItems[2].fulfilled).toBe(true);
    expect(result.picklist.lineItems[2].actualQuantity).toBe(0);
    expect(result.picklist.lineItems[3].fulfilled).toBe(true);
    expect(result.picklist.lineItems[3].actualQuantity).toBe(0);
  });

  it('product lines still allocate correctly alongside excluded packaging', () => {
    const result = recomputeTallies(
      typedState(
        'outbound',
        [
          line('AAA', 'BG', 40),
          line('BBB', 'BG', 30),
          packagingLine('9905613', 'BG', 10),
        ],
        [section('AAA', 40), section('BBB', 25)]
      )
    );

    expect(result.picklist.lineItems[0].actualQuantity).toBe(40);
    expect(result.picklist.lineItems[0].fulfilled).toBe(true);
    expect(result.picklist.lineItems[1].actualQuantity).toBe(25);
    expect(result.picklist.lineItems[1].fulfilled).toBe(false);
    // Packaging excluded
    expect(result.picklist.lineItems[2].actualQuantity).toBe(0);
    expect(result.picklist.lineItems[2].fulfilled).toBe(true);
  });
});
