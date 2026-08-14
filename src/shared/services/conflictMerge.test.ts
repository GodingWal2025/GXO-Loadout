import { describe, it, expect } from 'vitest';
import { mergeInspection, mergeInventory, mergePhotos } from './conflictMerge';
import type { Inspection, PalletInspection } from '../types/inspection';
import type { InventoryItem } from '../types/inventory';

describe('Deterministic Multi-Device Conflict Merge Policy', () => {
  it('merges non-overlapping pallet scans from concurrent devices without losing data', () => {
    const baseInspection: Inspection = {
      id: 'insp-001',
      type: 'outbound',
      siteId: 'site-1',
      status: 'IN_PROGRESS',
      startedAt: '2026-08-13T10:00:00.000Z',
      flaggedItemsCount: 0,
      picklist: { photoIds: [], loadNumber: { value: 'LOAD-1', source: 'manual' }, shipDate: { value: '2026-08-13', source: 'manual' }, lineItems: [] },
      bol: { photoIds: [], lineItems: [], deliveries: [] },
      staging: {
        stagingLocation: 'A-1',
        stagedCorrectly: 'Yes',
        paperBagsProperlyStacked: 'Yes',
        ltlPalletsSecured: 'Yes',
        mixedPalletsLabeled: 'Yes',
        multiStopStickersAttached: 'Yes',
        palletQuantityMatchesBOL: 'Yes',
        overviewPhotos: [],
        coverSheetPhotos: [],
        finalLanePhotos: [],
      },
      pallets: [
        {
          palletNumber: 1,
          palletType: 'Full Bag Pallet',
          deliveryId: 'del-1',
          passInspection: 'Pass',
          accuracyLabelAttached: 'Yes',
          lpnNumber: 'LPN-100',
          batchSections: [],
          batchCount: 1,
          photos: [],
        },
      ],
      lastEditedAt: '2026-08-13T10:00:00.000Z',
    };

    // Device A edited Pallet 1 (lpnNumber updated) and added Pallet 2
    const deviceA: Inspection = {
      ...baseInspection,
      pallets: [
        {
          palletNumber: 1,
          palletType: 'Full Bag Pallet',
          deliveryId: 'del-1',
          passInspection: 'Pass',
          accuracyLabelAttached: 'Yes',
          lpnNumber: 'LPN-100-EDITED',
          batchSections: [],
          batchCount: 1,
          photos: [],
        },
        {
          palletNumber: 2,
          palletType: 'Full Bag Pallet',
          deliveryId: 'del-1',
          passInspection: 'Pass',
          accuracyLabelAttached: 'Yes',
          lpnNumber: 'LPN-101',
          batchSections: [],
          batchCount: 1,
          photos: [],
        },
      ],
      lastEditedAt: '2026-08-13T10:02:00.000Z',
    };

    // Device B added Pallet 3 and took a photo on Pallet 1
    const deviceB: Inspection = {
      ...baseInspection,
      pallets: [
        {
          palletNumber: 1,
          palletType: 'Full Bag Pallet',
          deliveryId: 'del-1',
          passInspection: 'Pass',
          accuracyLabelAttached: 'Yes',
          lpnNumber: 'LPN-100',
          batchSections: [],
          batchCount: 1,
          photos: [
            {
              id: 'photo-b1',
              capturedAt: '2026-08-13T10:01:30.000Z',
              capturedBy: 'Inspector Bob',
              category: 'PLACARD',
              metadata: {} as any,
            },
          ],
        },
        undefined as any,
        {
          palletNumber: 3,
          palletType: 'Full Bag Pallet',
          deliveryId: 'del-1',
          passInspection: 'Pass',
          accuracyLabelAttached: 'Yes',
          lpnNumber: 'LPN-102',
          batchSections: [],
          batchCount: 1,
          photos: [],
        },
      ],
      lastEditedAt: '2026-08-13T10:01:30.000Z',
    };

    const merged = mergeInspection(deviceA, deviceB);

    expect(merged.pallets).toHaveLength(3);
    expect(merged.pallets[0].lpnNumber).toBe('LPN-100-EDITED');
    expect(merged.pallets[0].photos).toHaveLength(1);
    expect(merged.pallets[0].photos[0].id).toBe('photo-b1'); // Device B's photo preserved
    expect(merged.pallets[1].lpnNumber).toBe('LPN-101'); // Device A's added pallet retained
    expect(merged.pallets[2].lpnNumber).toBe('LPN-102'); // Device B's added pallet retained
  });

  it('resolves inspection status progression deterministically (COMPLETED > IN_PROGRESS > PENDING)', () => {
    const inspPending: Inspection = {
      id: 'insp-002',
      type: 'outbound',
      siteId: 'site-1',
      status: 'PENDING',
      startedAt: '2026-08-13T10:00:00.000Z',
      flaggedItemsCount: 0,
      picklist: {} as any,
      bol: {} as any,
      staging: {} as any,
      pallets: [],
    };
    const inspCompleted: Inspection = {
      ...inspPending,
      status: 'COMPLETED',
    };

    const merged = mergeInspection(inspPending, inspCompleted);
    expect(merged.status).toBe('COMPLETED');
  });

  it('merges inventory items keeping newer timestamp and description', () => {
    const invLocal: InventoryItem & { _rev?: number } = {
      id: 'item-1',
      sku: 'SKU-001',
      batch: 'BATCH-001',
      description: 'Corn 50LB (Updated Desc)',
      lastUpdated: '2026-08-13T12:00:00.000Z',
    };
    const invRemote: InventoryItem & { _rev?: number } = {
      id: 'item-1',
      sku: 'SKU-001',
      batch: 'BATCH-001',
      description: 'Corn 50LB',
      lastUpdated: '2026-08-13T11:00:00.000Z',
    };

    const merged = mergeInventory(invLocal, invRemote);
    expect(merged.description).toBe('Corn 50LB (Updated Desc)');
  });
});
