import { describe, expect, it } from 'vitest';
import type { Inspection } from '../shared/types/inspection';
import { buildInspectionListCardModel, getInspectionCardStatus } from './inspectionListCardModel';

describe('buildInspectionListCardModel', () => {
  it('renders legacy inspection lines with missing Suggestable fields safely', () => {
    const legacy = {
      id: 'legacy-inspection-1',
      type: 'outbound',
      picklist: {
        loadNumber: { value: 'LOAD-42', source: 'manual' },
        lineItems: [{ id: 'old-line', uom: 'BG', actualQuantity: 3 }],
      },
      bol: {},
      pallets: [{ batchSections: [{ batchCode: undefined }] }],
    } as unknown as Inspection;

    expect(() => buildInspectionListCardModel(legacy)).not.toThrow();
    expect(buildInspectionListCardModel(legacy)).toMatchObject({
      loadNumber: 'LOAD-42',
      totalExpected: 0,
      totalActual: 3,
      percentComplete: 0,
      hasUnlistedBatch: false,
      productLines: [{
        id: 'old-line', batchCode: '', actualQuantity: 3,
        expectedQuantity: 0, fulfilled: false,
      }],
    });
  });

  it('accepts legacy scalar fields and missing nested collections', () => {
    const legacy = {
      id: 'legacy-inspection-2', type: 'outbound',
      picklist: {
        loadNumber: 'LOAD-99',
        lineItems: [{
          id: 'old-line', batchCode: 'B-7', description: 'seed bag',
          expectedQuantity: 5, uom: 'BG', actualQuantity: 2,
        }],
      },
    } as unknown as Inspection;

    expect(buildInspectionListCardModel(legacy)).toMatchObject({
      loadNumber: 'LOAD-99', totalExpected: 5, totalActual: 2,
      productLines: [{ batchCode: 'B-7', expectedQuantity: 5 }],
      inboundLines: [],
    });
  });

  it('keeps a verifier-added batch flagged after it is added to the picklist', () => {
    const inspection = {
      id: 'inspection-exception',
      type: 'outbound',
      picklist: {
        lineItems: [{
          id: 'exception-line',
          batchCode: { value: 'EXTRA-7', source: 'manual' },
          sku: { value: null, source: 'manual' },
          description: { value: null, source: 'manual' },
          expectedQuantity: { value: 10, source: 'manual' },
          uom: 'BG',
          actualQuantity: 10,
          fulfilled: true,
          picklistException: {
            reason: 'not_on_original_picklist',
            addedAt: '2026-08-24T12:00:00.000Z',
            addedBy: 'Verifier A',
          },
        }],
      },
      bol: {},
      pallets: [{
        batchSections: [{ batchCode: { value: 'extra-7', source: 'manual' } }],
      }],
    } as unknown as Inspection;

    expect(buildInspectionListCardModel(inspection).hasUnlistedBatch).toBe(true);
  });

  it('classifies clean finished, unfinished, and issue loads distinctly', () => {
    const base = {
      id: 'status-inspection',
      type: 'outbound',
      status: 'COMPLETED',
      picklist: {
        lineItems: [{
          id: 'line-1',
          batchCode: { value: 'BATCH-1', source: 'manual' },
          sku: { value: 'SKU-1', source: 'manual' },
          description: { value: 'Product', source: 'manual' },
          expectedQuantity: { value: 60, source: 'manual' },
          uom: 'BG',
          actualQuantity: 60,
          fulfilled: true,
        }],
      },
      bol: {},
      pallets: [],
    } as unknown as Inspection;

    expect(getInspectionCardStatus(base, buildInspectionListCardModel(base), 0)).toBe('complete');

    const unfinished = { ...base, status: 'IN_PROGRESS' } as Inspection;
    expect(getInspectionCardStatus(unfinished, buildInspectionListCardModel(unfinished), 0))
      .toBe('incomplete');

    const quantityIssue = {
      ...base,
      picklist: {
        ...base.picklist,
        lineItems: [{ ...base.picklist.lineItems[0], actualQuantity: 55, fulfilled: false }],
      },
    } as unknown as Inspection;
    expect(getInspectionCardStatus(quantityIssue, buildInspectionListCardModel(quantityIssue), 0))
      .toBe('issue');
  });

  it('classifies explicit flags, inbound damage, and cross-reference mismatches as issues', () => {
    const inbound = {
      id: 'inbound-issue',
      type: 'inbound',
      status: 'COMPLETED',
      picklist: { lineItems: [] },
      bol: {},
      pallets: [],
      inbound: {
        lineItems: [{
          id: 'received-1',
          batch: { value: 'BATCH-1' },
          qtyReceived: { value: 60 },
          qtyDamaged: { value: 2 },
          uom: 'BG',
        }],
      },
    } as unknown as Inspection;
    expect(getInspectionCardStatus(inbound, buildInspectionListCardModel(inbound), 0)).toBe('issue');

    const crossReferenceIssue = {
      ...inbound,
      type: 'outbound',
      inbound: undefined,
      crossReference: { matches: false },
    } as unknown as Inspection;
    expect(getInspectionCardStatus(
      crossReferenceIssue,
      buildInspectionListCardModel(crossReferenceIssue),
      0
    )).toBe('issue');

    const flagged = { ...inbound, status: 'FLAGGED' } as Inspection;
    expect(getInspectionCardStatus(flagged, buildInspectionListCardModel(flagged), 1)).toBe('issue');
  });
});
