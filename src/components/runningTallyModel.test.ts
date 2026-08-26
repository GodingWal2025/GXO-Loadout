import { describe, expect, it } from 'vitest';
import type { PicklistLineItemEntry, Uom } from '../shared';
import { mlSuggestable } from '../shared';
import { formatTallyQuantity, tallyDisplayCount, tallyTotalsByUnit } from './runningTallyModel';

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
});
