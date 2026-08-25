import { describe, expect, it } from 'vitest';
import type { PicklistLineItemEntry } from '../types/inspection';
import { reconcilePicklistPageBoundary } from './picklistPageMerge';

const ml = <T>(value: T | null) => ({ value, source: 'ml' as const });

function line(
  id: string,
  values: { batch?: string | null; sku?: string | null; description?: string | null; qty?: number | null } = {}
): PicklistLineItemEntry {
  return {
    id,
    batchCode: ml(values.batch ?? null),
    sku: ml(values.sku ?? null),
    description: ml(values.description ?? null),
    expectedQuantity: ml(values.qty ?? null),
    uom: 'BG',
    actualQuantity: 0,
    fulfilled: false,
  };
}

describe('picklist page-boundary reconciliation', () => {
  it('joins complementary halves of a line split across two pages', () => {
    const result = reconcilePicklistPageBoundary(
      [line('page-1-row', { batch: 'P28GE1JM8', sku: '91007244', description: 'C.CL.201' })],
      [line('page-2-row', { description: '40USP.UB.US', qty: 24 })]
    );

    expect(result.changed).toBe(true);
    expect(result.existing).toEqual([]);
    expect(result.incoming[0]).toMatchObject({
      id: 'page-1-row',
      batchCode: { value: 'P28GE1JM8' },
      sku: { value: '91007244' },
      description: { value: 'C.CL.201 40USP.UB.US' },
      expectedQuantity: { value: 24 },
    });
  });

  it('does not combine adjacent complete rows', () => {
    const first = line('one', { batch: 'P28GE1JM8', sku: '91007244', qty: 24 });
    const second = line('two', { batch: 'P18S15LN8', sku: '91007301', qty: 21 });
    const result = reconcilePicklistPageBoundary([first], [second]);
    expect(result).toEqual({ existing: [first], incoming: [second], changed: false });
  });

  it('drops a row repeated at the page boundary', () => {
    const repeated = line('one', { batch: 'P28GE1JM8', sku: '91007244', qty: 24 });
    const duplicate = { ...repeated, id: 'two' };
    const result = reconcilePicklistPageBoundary([repeated], [duplicate]);
    expect(result.changed).toBe(true);
    expect(result.existing).toEqual([repeated]);
    expect(result.incoming).toEqual([]);
  });

  it('does not join rows assigned to different deliveries', () => {
    const first = { ...line('one', { batch: 'P28GE1JM8' }), deliveryId: 'delivery-1' };
    const second = { ...line('two', { qty: 24 }), deliveryId: 'delivery-2' };
    expect(reconcilePicklistPageBoundary([first], [second]).changed).toBe(false);
  });
});
