import { describe, expect, it } from 'vitest';
import type { PicklistLineItemEntry, Uom } from '../shared';
import { mlSuggestable } from '../shared';
import { formatTallyQuantity, groupTallyLines, tallyDisplayCount, tallyTotalsByUnit } from './runningTallyModel';

function line(uom: Uom, expected: number, actualBags: number, description = ''): PicklistLineItemEntry {
  return {
    id: `${uom}-${description}`,
    batchCode: mlSuggestable('P21R1SHTB'),
    sku: mlSuggestable('91007244'),
    description: mlSuggestable(description),
    expectedQuantity: mlSuggestable(expected),
    uom,
    actualQuantity: actualBags,
    fulfilled: true,
  };
}

describe('running tally unit model', () => {
  it('shows a pallet picklist unit as its 60-bag equivalent', () => {
    expect(tallyDisplayCount(line('PL', 1, 60))).toMatchObject({
      unit: 'BG',
      actual: 60,
      expected: 60,
    });
  });

  it('shows Seedpaks and Minibulks as whole units', () => {
    expect(tallyDisplayCount(line('SP', 1, 50, 'C.CL.201.50USP.US'))).toMatchObject({
      unit: 'SP',
      actual: 1,
      expected: 1,
    });
    expect(tallyDisplayCount(line('MB', 1, 45, 'C.CL.201.45SCUMB.US'))).toMatchObject({
      unit: 'MB',
      actual: 1,
      expected: 1,
    });
  });

  it('separates BG, SP, and MB totals instead of combining bag equivalents', () => {
    const totals = tallyTotalsByUnit([
      line('BG', 50, 50),
      line('PL', 1, 60),
      line('SP', 1, 50, 'C.CL.201.50USP.US'),
      line('MB', 1, 45, 'C.CL.201.45SCUMB.US'),
    ]);

    expect(totals.BG).toMatchObject({ actual: 110, expected: 110 });
    expect(totals.SP).toMatchObject({ actual: 1, expected: 1 });
    expect(totals.MB).toMatchObject({ actual: 1, expected: 1 });
  });

  it('formats partial units without long floating-point tails', () => {
    expect(formatTallyQuantity(0.5)).toBe('0.5');
    expect(formatTallyQuantity(2)).toBe('2');
  });

  it('combines duplicate partial BG rows for one batch', () => {
    const groups = groupTallyLines([line('BG', 8, 8), line('BG', 12, 12)]);

    expect(groups).toHaveLength(1);
    expect(groups[0].display).toMatchObject({ unit: 'BG', actual: 20, expected: 20 });
    expect(groups[0].lines).toHaveLength(2);
  });

  it('caps combined BG tally items at 60 bags', () => {
    const groups = groupTallyLines([line('BG', 40, 40), line('BG', 40, 30)]);

    expect(groups.map((group) => [group.display.actual, group.display.expected])).toEqual([
      [60, 60],
      [10, 20],
    ]);
  });

  it('does not combine different batches or full 60BG rows', () => {
    const first = line('BG', 8, 8);
    const second = line('BG', 12, 12);
    second.batchCode = mlSuggestable('OTHER');
    const full = line('BG', 60, 60);

    expect(groupTallyLines([first, second, full])).toHaveLength(3);
  });
});
