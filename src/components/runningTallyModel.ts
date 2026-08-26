import type { PicklistLineItemEntry } from '../shared';
import { bagsPerUnit, expectedBags } from '../shared';

export type TallyDisplayUnit = 'BG' | 'SP' | 'MB';

export interface TallyDisplayCount {
  unit: TallyDisplayUnit;
  actual: number;
  expected: number;
  actualBags: number;
  expectedBags: number;
}

const cleanNumber = (value: number): number => Math.round(value * 1000) / 1000;

/** Convert one picklist line into the unit operators expect to see. */
export function tallyDisplayCount(line: PicklistLineItemEntry): TallyDisplayCount {
  const rawUnit = String(line.uom || 'BG').toUpperCase();
  const unit: TallyDisplayUnit = rawUnit === 'SP' ? 'SP' : rawUnit === 'MB' ? 'MB' : 'BG';
  const actualBags = line.actualQuantity || 0;
  const expectedBagCount = expectedBags(line.uom, line.expectedQuantity.value, line.description.value);

  if (unit === 'SP' || unit === 'MB') {
    const bagsInUnit = bagsPerUnit(unit, line.description.value);
    return {
      unit,
      actual: cleanNumber(bagsInUnit ? actualBags / bagsInUnit : actualBags),
      expected: cleanNumber(line.expectedQuantity.value || 0),
      actualBags,
      expectedBags: expectedBagCount,
    };
  }

  // PL is intentionally included here: one expected PL becomes 60 expected BG,
  // and its scanned actual remains the physical bag count.
  return {
    unit: 'BG',
    actual: actualBags,
    expected: expectedBagCount,
    actualBags,
    expectedBags: expectedBagCount,
  };
}

export function tallyTotalsByUnit(lines: PicklistLineItemEntry[]): Record<TallyDisplayUnit, TallyDisplayCount> {
  const totals: Record<TallyDisplayUnit, TallyDisplayCount> = {
    BG: { unit: 'BG', actual: 0, expected: 0, actualBags: 0, expectedBags: 0 },
    SP: { unit: 'SP', actual: 0, expected: 0, actualBags: 0, expectedBags: 0 },
    MB: { unit: 'MB', actual: 0, expected: 0, actualBags: 0, expectedBags: 0 },
  };

  for (const line of lines) {
    const count = tallyDisplayCount(line);
    const total = totals[count.unit];
    total.actual = cleanNumber(total.actual + count.actual);
    total.expected = cleanNumber(total.expected + count.expected);
    total.actualBags += count.actualBags;
    total.expectedBags += count.expectedBags;
  }
  return totals;
}

export function formatTallyQuantity(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
