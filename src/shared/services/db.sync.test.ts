import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  if (!globalThis.window) {
    Object.defineProperty(globalThis, 'window', { value: new EventTarget(), configurable: true });
  }
});

describe('shared-storage offline queue', () => {
  it('durably queues saves, photo uploads, and delete tombstones', async () => {
    const {
      dbGetInspection,
      dbHardDeleteInspection,
      dbListAllInspections,
      dbListSyncQueue,
      dbMakeSyncQueueItemReady,
      dbRetrySyncQueueItem,
      dbSaveInspection,
      dbSavePhotoBlob,
      getDB,
    } = await import('./db');

    const inspection = {
      id: 'inspection-sync-test',
      type: 'outbound',
      siteId: 'site-a',
      status: 'IN_PROGRESS',
      startedAt: '2026-01-01T00:00:00.000Z',
      picklist: { photoIds: [], lineItems: [] },
      bol: { photoIds: [], lineItems: [], deliveries: [] },
      pallets: [],
      staging: {},
      flaggedItemsCount: 0,
    } as any;

    await dbSaveInspection(inspection);
    await dbSavePhotoBlob('photo-sync-test', inspection.id, new Blob(['image'], { type: 'image/jpeg' }));

    let queue = await dbListSyncQueue();
    expect(queue.map((item) => item.id).sort()).toEqual([
      'photo:photo-sync-test',
      'record:inspections:inspection-sync-test',
    ]);
    const db = await getDB();
    expect((await db.get('photoBlobs', 'photo-sync-test'))?.uploaded).toBe(false);

    const photoQueueItem = queue.find((item) => item.id === 'photo:photo-sync-test')!;
    await dbRetrySyncQueueItem(photoQueueItem);
    const delayed = (await dbListSyncQueue()).find((item) => item.id === photoQueueItem.id)!;
    expect(delayed.nextAttemptAt).toBeDefined();
    await dbMakeSyncQueueItemReady(delayed);
    const ready = (await dbListSyncQueue()).find((item) => item.id === photoQueueItem.id)!;
    expect(ready.nextAttemptAt).toBeUndefined();

    await dbHardDeleteInspection(inspection.id);
    expect((await dbGetInspection(inspection.id))?.deleted).toBe(true);
    expect(await dbListAllInspections()).toEqual([]);
    queue = await dbListSyncQueue();
    const recordItem = queue.find((item) => item.id === 'record:inspections:inspection-sync-test');
    expect(recordItem?.operation).toBe('put-record');
    expect(recordItem?.operation === 'put-record' && (recordItem.record as any).deleted).toBe(true);
  });
});
