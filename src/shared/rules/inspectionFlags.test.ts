import { describe, expect, it } from 'vitest';
import type { Inspection, PicklistLineItemEntry } from '../types/inspection';
import { emptySuggestable } from '../types/inspection';
import { countInspectionFlags, countQuantityOverages } from './inspectionFlags';

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
});
