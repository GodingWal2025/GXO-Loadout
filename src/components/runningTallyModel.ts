import type { PicklistLineItemEntry } from '../shared';
import { actualCountInUom, BAGS_PER_PALLET, expectedBags, normalizeBatchCode } from '../shared';

export type TallyDisplayUnit = 'BG' | 'SP' | 'MB';

export interface TallyDisplayCount {
  unit: TallyDisplayUnit;
  actual: number;
  expected: number;
  actualBags: number;
  expectedBags: number;
}

export interface TallyLineGroup {
  id: string;
  batchCode: string | null;
  lines: PicklistLineItemEntry[];
  display: TallyDisplayCount;
}

const cleanNumber = (value: number): number => Math.round(value * 1000) / 1000;

/** Convert one picklist line into the unit operators expect to see. */
export function tallyDisplayCount(line: PicklistLineItemEntry): TallyDisplayCount {
  const rawUnit = String(line.uom || 'BG').toUpperCase();
  const unit: TallyDisplayUnit = rawUnit === 'SP' ? 'SP' : rawUnit === 'MB' ? 'MB' : 'BG';
  const actualBags = line.actualQuantity || 0;
  const expectedBagCount = expectedBags(line.uom, line.expectedQuantity.value, line.description.value);

  if (unit === 'SP' || unit === 'MB') {
    return {
      unit,
      actual: cleanNumber(actualCountInUom(unit, actualBags, line.description.value)),
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

/**
 * Combine duplicate partial BG/BAG picklist rows for one batch into physical
 * pallet-sized tally items. A displayed item can never exceed 60 bags.
 */
export function groupTallyLines(lines: PicklistLineItemEntry[]): TallyLineGroup[] {
  type PartialAccumulator = {
    kind: 'partial';
    batchCode: string;
    normalizedBatch: string;
    lines: PicklistLineItemEntry[];
  };
  type SingleAccumulator = { kind: 'single'; group: TallyLineGroup };

  const ordered: Array<PartialAccumulator | SingleAccumulator> = [];
  const partialByBatch = new Map<string, PartialAccumulator>();

  for (const line of lines) {
    const display = tallyDisplayCount(line);
    const rawUnit = String(line.uom || 'BG').toUpperCase();
    const normalizedBatch = normalizeBatchCode(line.batchCode.value);
    const isPartialBag =
      (rawUnit === 'BG' || rawUnit === 'BAG') &&
      display.expectedBags > 0 &&
      display.expectedBags < BAGS_PER_PALLET &&
      Boolean(normalizedBatch);

    if (!isPartialBag) {
      ordered.push({
        kind: 'single',
        group: {
          id: line.id,
          batchCode: line.batchCode.value,
          lines: [line],
          display,
        },
      });
      continue;
    }

    let accumulator = partialByBatch.get(normalizedBatch);
    if (!accumulator) {
      accumulator = {
        kind: 'partial',
        batchCode: line.batchCode.value || normalizedBatch,
        normalizedBatch,
        lines: [],
      };
      partialByBatch.set(normalizedBatch, accumulator);
      ordered.push(accumulator);
    }
    accumulator.lines.push(line);
  }

  return ordered.flatMap((entry) => {
    if (entry.kind === 'single') return [entry.group];

    let expectedRemaining = entry.lines.reduce(
      (sum, line) => sum + tallyDisplayCount(line).expectedBags,
      0
    );
    let actualRemaining = entry.lines.reduce(
      (sum, line) => sum + tallyDisplayCount(line).actualBags,
      0
    );
    const groups: TallyLineGroup[] = [];
    let part = 0;

    while (expectedRemaining > 0) {
      const expected = Math.min(BAGS_PER_PALLET, expectedRemaining);
      const isLast = expectedRemaining <= BAGS_PER_PALLET;
      const actual = isLast ? actualRemaining : Math.min(expected, actualRemaining);
      groups.push({
        id: `${entry.lines.map((line) => line.id).join(':')}:${part}`,
        batchCode: entry.batchCode,
        lines: entry.lines,
        display: {
          unit: 'BG',
          actual,
          expected,
          actualBags: actual,
          expectedBags: expected,
        },
      });
      expectedRemaining -= expected;
      actualRemaining -= actual;
      part += 1;
    }

    return groups;
  });
}

export function formatTallyQuantity(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
