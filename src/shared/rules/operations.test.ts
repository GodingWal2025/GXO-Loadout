import { describe, expect, it } from 'vitest';
import { emptyInspection } from '../hooks/useInspection';
import { inspectionReadiness, reconcileInspection, repeatPallet } from './operations';
import { requiredPalletPhotos } from './photoRequirements';
import { mergeInspection } from '../services/conflictMerge';
import { evidencePhotoIds, escapeEvidenceHtml } from '../../lib/inspectionEvidence';
import { needsDocumentReview } from '../../components/DocumentReview';
import type { PicklistLineItemEntry, PalletInspection, InspectionPhoto } from '../types/inspection';

const t = (_key: string, english: string) => english;
const field = <T,>(value: T) => ({ value, source: 'manual' as const });
const line = (id: string, uom: PicklistLineItemEntry['uom'], quantity: number, actual: number, description = ''): PicklistLineItemEntry => ({
  id, sku: field(id), batchCode: field(id), description: field(description), expectedQuantity: field(quantity), uom, actualQuantity: actual, fulfilled: false,
});
const pallet = (): PalletInspection => ({
  palletNumber: 1, palletType: 'Full Bag Pallet', deliveryId: 'delivery', batchCount: 1,
  passInspection: 'Pass', accuracyLabelAttached: 'Yes', lpnNumber: 'unique-lpn', completedAt: '2026-01-01',
  photos: [{ id: 'photo', slotKey: 'FRONT_VIEW' } as InspectionPhoto],
  batchSections: [{ id: 'section', batchCode: field('BATCH'), productName: field('Product'), expectedBagCount: 60, actualBagCount: field(60), bagsPerLayer: 10, layerCount: 6, aiLayerSamples: [6] }],
});

describe('operational readiness and reconciliation', () => {
  it('keeps bags, Seedpaks and Minibulks separate and converts PL to bags', () => {
    const inspection = emptyInspection('site');
    inspection.picklist.lineItems = [line('bags', 'PL', 2, 120), line('totes', 'SP', 2, 80, '40USP'), line('bulk', 'MB', 1, 45, '45UMB')];
    const rows = reconcileInspection(inspection);
    expect(rows.map(row => [row.unit, row.expected, row.actual])).toEqual([['BG', 120, 120], ['SP', 2, 2], ['MB', 1, 1]]);
  });
  it('does not let one SKU overage erase another SKU shortage', () => {
    const inspection = emptyInspection('site');
    inspection.picklist.lineItems = [line('short', 'BG', 60, 50), line('over', 'BG', 60, 70)];
    expect(inspectionReadiness(inspection, t).filter(issue => issue.id.startsWith('quantity-'))).toHaveLength(2);
  });
  it('excludes cancelled and OCR packaging rows but keeps manual packaging', () => {
    const inspection = emptyInspection('site');
    const packaging = line('87674223', 'BG', 1, 0);
    inspection.picklist.lineItems = [packaging, { ...line('cancelled', 'BG', 1, 0), cancelled: true }];
    expect(reconcileInspection(inspection)).toHaveLength(1);
    packaging.sku.source = 'ml';
    expect(reconcileInspection(inspection)).toHaveLength(0);
  });
  it('includes physically scanned unlisted batches', () => {
    const inspection = emptyInspection('site');
    inspection.pallets = [pallet()];
    expect(reconcileInspection(inspection)[0]).toMatchObject({ batch: 'BATCH', actual: 60, expected: 0, unexpected: true });
  });
  it('does not invent inbound expected quantities', () => {
    const inspection = emptyInspection('site', 'inbound');
    inspection.inbound!.lineItems = [{ id: 'in', itemNumber: 1, materialNumber: field('SKU'), batch: field('B'), uom: 'SP', qtyReceived: field(4), qtyDamaged: field(0), onBol: true }];
    expect(reconcileInspection(inspection)[0]).toMatchObject({ unknownExpected: true, actual: 4, unit: 'SP' });
  });
  it('shares camera policy for mixed pallets and returned Seedpaks', () => {
    expect(requiredPalletPhotos('Mixed Bag Pallet', 3)).toHaveLength(7);
    expect(requiredPalletPhotos('Seedpak', 1, true)).toEqual(['PLACARD', 'SIDE_VIEW_1', 'SIDE_VIEW_2']);
  });
  it('keeps incomplete and failed pallets on the readiness checklist', () => {
    const inspection = emptyInspection('site');
    inspection.pallets = [{ ...pallet(), passInspection: 'Fail', repeatSourcePallet: 1 }];
    const issues = inspectionReadiness(inspection, t);
    expect(issues.find(issue => issue.id === 'photos-0')?.to).toBe(`/inspection/${inspection.id}/pallet/0`);
    expect(issues.some(issue => issue.id === 'repeat-0')).toBe(true);
    expect(issues.some(issue => issue.id === 'failed-0')).toBe(true);
  });
});

describe('repeat, review, and evidence safety', () => {
  it('copies reusable product details without identity, counts, or evidence', () => {
    const original = pallet();
    const copy = repeatPallet(original, 2, () => 'new-section');
    expect(copy).toMatchObject({ palletNumber: 2, deliveryId: 'delivery', photos: [], repeatSourcePallet: 1 });
    expect(copy.lpnNumber).toBeUndefined();
    expect(copy.completedAt).toBeUndefined();
    expect(copy.repeatConfirmedAt).toBeUndefined();
    expect(copy.batchSections[0]).toMatchObject({ id: 'new-section', actualBagCount: { value: null }, batchCode: { value: 'BATCH' } });
    expect(copy.batchSections[0].aiLayerSamples).toBeUndefined();
    expect(original.batchSections[0].actualBagCount.value).toBe(60);
  });
  it('requires explicit review of OCR rows and ignores cancelled rows', () => {
    const row = line('a', 'BG', 2, 0);
    row.sku.source = 'ml';
    expect(needsDocumentReview(row)).toBe(true);
    expect(needsDocumentReview({ ...row, reviewedAt: 'now' })).toBe(false);
    expect(needsDocumentReview({ ...row, cancelled: true })).toBe(false);
  });
  it('preserves notes and handoffs from both devices during conflict merge', () => {
    const local = emptyInspection('site');
    const remote = structuredClone(local);
    local.operationalNotes = [{ id: 'a', at: '2026-01-01', by: 'A', kind: 'handoff', text: 'A note' }];
    remote.operationalNotes = [{ id: 'b', at: '2026-01-02', by: 'B', kind: 'resolution', text: 'B note' }];
    local.handoffLog = [{ at: '2026-01-01', toInspector: 'A', palletsCompletedByPrevious: [], note: 'A' }];
    remote.handoffLog = [{ at: '2026-01-02', toInspector: 'B', palletsCompletedByPrevious: [], note: 'B' }];
    const merged = mergeInspection(local, remote);
    expect(merged.operationalNotes?.map(note => note.id)).toEqual(['a', 'b']);
    expect(merged.handoffLog).toHaveLength(2);
  });
  it('collects all document, pallet and staging evidence without duplicate images', () => {
    const inspection = emptyInspection('site');
    inspection.picklist.photoIds = ['document', 'photo'];
    inspection.pallets = [pallet()];
    inspection.inbound!.photoIds = ['inbound'];
    inspection.staging.finalLanePhotos = [{ id: 'staging' } as InspectionPhoto];
    expect(evidencePhotoIds(inspection)).toEqual(['document', 'photo', 'inbound', 'staging']);
    expect(escapeEvidenceHtml('<script>"&')).toBe('&lt;script&gt;&quot;&amp;');
  });
});
