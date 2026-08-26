import { describe, expect, it } from 'vitest';
import type { Inspection, PicklistLineItemEntry } from '../types/inspection';
import { emptySuggestable } from '../types/inspection';
import { countInspectionFlags, countQuantityOverages, listInspectionFlags } from './inspectionFlags';

function inspectionWith(actual: number, expected = 60): Inspection {
  const line: PicklistLineItemEntry = {
    id: 'line-1',
    batchCode: { value: 'P60SM1PB8', source: 'manual' },
    sku: emptySuggestable<string>(),
    description: emptySuggestable<string>(),
    expectedQuantity: { value: expected, source: 'manual' },
    uom: 'BG',
    actualQuantity: actual,
    fulfilled: actual >= expected,
  };

  return {
    type: 'outbound',
    picklist: { lineItems: [line] },
    pallets: [],
    staging: {
      overviewPhotos: [],
      coverSheetPhotos: [],
    },
    flaggedItemsCount: 0,
  } as unknown as Inspection;
}

describe('order discrepancy flags', () => {
  it('flags a 61 / 60 batch as an order-level issue', () => {
    const inspection = inspectionWith(61, 60);

    expect(countQuantityOverages(inspection)).toBe(1);
    expect(countInspectionFlags(inspection)).toBe(1);
  });

  it('does not flag an exact count or an in-progress shortage', () => {
    expect(countQuantityOverages(inspectionWith(60, 60))).toBe(0);
    expect(countQuantityOverages(inspectionWith(45, 60))).toBe(0);
  });

  it('keeps quality flags and quantity overages additive', () => {
    const inspection = inspectionWith(61, 60);
    inspection.qualityFlag = { reason: 'other', note: 'Needs review' };

    expect(countInspectionFlags(inspection)).toBe(2);
  });

  it('ignores an overage on a cancelled line', () => {
    const inspection = inspectionWith(61, 60);
    inspection.picklist.lineItems[0].cancelled = true;

    expect(countQuantityOverages(inspection)).toBe(0);
  });

  it('counts a verifier-added batch as an inspection flag', () => {
    const inspection = inspectionWith(60, 60);
    inspection.picklist.lineItems[0].picklistException = {
      reason: 'not_on_original_picklist',
      addedAt: '2026-08-24T12:00:00.000Z',
      addedBy: 'Verifier A',
    };

    expect(countInspectionFlags(inspection)).toBe(1);
  });

  it('lists the same two issues shown by the flagged badge', () => {
    const inspection = inspectionWith(61, 60);
    inspection.picklist.lineItems[0].picklistException = {
      reason: 'not_on_original_picklist',
      addedAt: '2026-08-24T12:00:00.000Z',
      addedBy: 'Verifier A',
    };

    expect(listInspectionFlags(inspection)).toEqual([
      expect.objectContaining({
        source: 'unlisted_batch',
        batchCode: 'P60SM1PB8',
        flaggedBy: 'Verifier A',
      }),
      expect.objectContaining({
        source: 'quantity_overage',
        batchCode: 'P60SM1PB8',
        actual: 61,
        expected: 60,
      }),
    ]);
    expect(countInspectionFlags(inspection)).toBe(2);
  });
});
