// Local offline cache and durable retry queue. Shared Azure storage is the
// source of truth; IndexedDB keeps capture working when warehouse Wi-Fi drops.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Inspection } from '../types/inspection';
import { emptySuggestable } from '../types/inspection';
import type { InventoryItem } from '../types/inventory';

interface InspectionDB extends DBSchema {
  inspections: {
    key: string;
    value: Inspection;
    indexes: { 'by-site': string; 'by-status': string; 'by-updatedAt': string };
  };
  photoBlobs: {
    key: string;
    value: {
      photoId: string;
      inspectionId: string;
      blob: Blob;
      capturedAt: string;
      uploaded: boolean;
    };
    indexes: { 'by-inspection': string; 'by-uploaded': string };
  };
  inventory: {
    key: string;
    value: InventoryItem;
    indexes: { 'by-sku': string; 'by-batch': string };
  };
  syncQueue: {
    key: string;
    value: SyncQueueItem;
    indexes: { 'by-createdAt': string };
  };
}

export type SharedRecordKind = 'inspections' | 'inventory' | 'sites' | 'inspectors' | 'staging';

export type SyncQueueItem =
  | {
      id: string;
      operation: 'put-record';
      kind: SharedRecordKind;
      record: { id: string };
      createdAt: string;
      attempts: number;
      nextAttemptAt?: string;
    }
  | {
      id: string;
      operation: 'upload-photo';
      photoId: string;
      createdAt: string;
      attempts: number;
      nextAttemptAt?: string;
    };

const DB_NAME = 'loadout';
const DB_VERSION = 5;

let dbPromise: Promise<IDBPDatabase<InspectionDB>> | null = null;

function requestSync(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('loadout-sync-request'));
}

export function getDB(): Promise<IDBPDatabase<InspectionDB>> {
  if (!dbPromise) {
    dbPromise = openDB<InspectionDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (!db.objectStoreNames.contains('inspections')) {
          const store = db.createObjectStore('inspections', { keyPath: 'id' });
          store.createIndex('by-site', 'siteId');
          store.createIndex('by-status', 'status');
          store.createIndex('by-updatedAt', 'lastEditedAt');
        }
        if (!db.objectStoreNames.contains('photoBlobs')) {
          const store = db.createObjectStore('photoBlobs', { keyPath: 'photoId' });
          store.createIndex('by-inspection', 'inspectionId');
          store.createIndex('by-uploaded', 'uploaded');
        }
        if (!db.objectStoreNames.contains('inventory')) {
          const store = db.createObjectStore('inventory', { keyPath: 'id' });
          store.createIndex('by-sku', 'sku');
          store.createIndex('by-batch', 'batch');
        }
        // Versions before v4 used an incompatible auto-increment queue. A
        // device can skip releases, so handle a direct v3 -> v5 upgrade too.
        if (oldVersion < 4 && db.objectStoreNames.contains('syncQueue')) {
          db.deleteObjectStore('syncQueue');
        }
        if (!db.objectStoreNames.contains('syncQueue')) {
          const store = db.createObjectStore('syncQueue', { keyPath: 'id' });
          store.createIndex('by-createdAt', 'createdAt');
        }
      },
    });
  }
  return dbPromise;
}

export async function dbSaveInspection(inspection: Inspection): Promise<void> {
  const db = await getDB();
  const now = new Date().toISOString();
  const saved = { ...inspection, lastEditedAt: now };
  const tx = db.transaction(['inspections', 'syncQueue'], 'readwrite');
  await tx.objectStore('inspections').put(saved);
  await tx.objectStore('syncQueue').put(recordQueueItem('inspections', saved));
  await tx.done;
  requestSync();
  window.dispatchEvent(new CustomEvent('loadout-data-updated'));
}

function migrateInspection(inspection: Inspection | undefined): Inspection | undefined {
  if (!inspection) return inspection;

  if (inspection.bol && !Array.isArray(inspection.bol.lineItems)) {
    inspection = { ...inspection, bol: { ...inspection.bol, lineItems: [] } };
  }

  if (!inspection.picklist?.lineItems?.length) return inspection;
  let changed = false;
  const lineItems = inspection.picklist.lineItems.map((line) => {
    if (line.sku !== undefined && line.description !== undefined) return line;
    changed = true;
    const legacy = line.productName;
    const { productName: _drop, ...rest } = line;
    return {
      ...rest,
      sku: line.sku ?? emptySuggestable<string>(),
      description: line.description ?? legacy ?? emptySuggestable<string>(),
    };
  });

  return changed
    ? { ...inspection, picklist: { ...inspection.picklist, lineItems } }
    : inspection;
}

export async function dbGetInspection(id: string): Promise<Inspection | undefined> {
  const db = await getDB();
  return migrateInspection(await db.get('inspections', id));
}

export async function dbListAllInspections(): Promise<Inspection[]> {
  const db = await getDB();
  return (await db.getAll('inspections')).filter((inspection) => !inspection.deleted);
}

export async function dbListInspectionsForSite(siteId: string): Promise<Inspection[]> {
  const db = await getDB();
  const inspections = await db.getAllFromIndex('inspections', 'by-site', siteId);
  return inspections
    .filter((inspection) => !inspection.archived && !inspection.deleted)
    .sort((a, b) => (b.lastEditedAt || '').localeCompare(a.lastEditedAt || ''));
}

export async function dbListInProgressForSite(siteId: string): Promise<Inspection[]> {
  return (await dbListInspectionsForSite(siteId)).filter(
    (inspection) => inspection.status === 'PENDING' || inspection.status === 'IN_PROGRESS'
  );
}

export async function dbListCompletedForSite(siteId: string): Promise<Inspection[]> {
  return (await dbListInspectionsForSite(siteId)).filter(
    (inspection) => inspection.status === 'COMPLETED' || inspection.status === 'FLAGGED'
  );
}

export async function dbHardDeleteInspection(id: string): Promise<void> {
  const db = await getDB();
  const inspection = await db.get('inspections', id);
  if (!inspection) return;
  const now = new Date().toISOString();
  const tombstone: Inspection = { ...inspection, deleted: true, deletedAt: now, lastEditedAt: now };
  const tx = db.transaction(['inspections', 'syncQueue'], 'readwrite');
  await tx.objectStore('inspections').put(tombstone);
  await tx.objectStore('syncQueue').put(recordQueueItem('inspections', tombstone));
  await tx.done;
  requestSync();
  window.dispatchEvent(new CustomEvent('loadout-data-updated'));
}

export async function dbArchiveInspection(id: string): Promise<void> {
  const db = await getDB();
  const inspection = await db.get('inspections', id);
  if (!inspection) return;
  await dbSaveInspection({ ...inspection, archived: true, lastEditedAt: new Date().toISOString() });
}

export async function dbSavePhotoBlob(
  photoId: string,
  inspectionId: string,
  blob: Blob
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['photoBlobs', 'syncQueue'], 'readwrite');
  await tx.objectStore('photoBlobs').put({
    photoId,
    inspectionId,
    blob,
    capturedAt: new Date().toISOString(),
    uploaded: false,
  });
  await tx.objectStore('syncQueue').put({
    id: `photo:${photoId}`,
    operation: 'upload-photo',
    photoId,
    createdAt: new Date().toISOString(),
    attempts: 0,
  });
  await tx.done;
  requestSync();
}

export async function dbGetPhotoBlob(photoId: string): Promise<Blob | undefined> {
  const db = await getDB();
  return (await db.get('photoBlobs', photoId))?.blob;
}

export async function dbSaveInventoryItems(items: InventoryItem[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['inventory', 'syncQueue'], 'readwrite');
  for (const item of items) {
    await tx.objectStore('inventory').put(item);
    await tx.objectStore('syncQueue').put(recordQueueItem('inventory', item));
  }
  await tx.done;
  requestSync();
}

export async function dbUpdateInventoryItem(item: InventoryItem): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['inventory', 'syncQueue'], 'readwrite');
  await tx.objectStore('inventory').put(item);
  await tx.objectStore('syncQueue').put(recordQueueItem('inventory', item));
  await tx.done;
  requestSync();
}

export async function dbDeleteInventoryItem(id: string): Promise<void> {
  const db = await getDB();
  const existing = await db.get('inventory', id);
  if (!existing) return;
  const tombstone = { ...existing, deleted: true, lastUpdated: new Date().toISOString() };
  const tx = db.transaction(['inventory', 'syncQueue'], 'readwrite');
  await tx.objectStore('inventory').delete(id);
  await tx.objectStore('syncQueue').put(recordQueueItem('inventory', tombstone));
  await tx.done;
  requestSync();
}

export async function dbListInventoryItems(): Promise<InventoryItem[]> {
  const db = await getDB();
  return db.getAll('inventory');
}

export async function dbClearInventory(): Promise<void> {
  const db = await getDB();
  const items = await db.getAll('inventory');
  const tx = db.transaction(['inventory', 'syncQueue'], 'readwrite');
  await tx.objectStore('inventory').clear();
  const now = new Date().toISOString();
  for (const item of items) {
    await tx.objectStore('syncQueue').put(
      recordQueueItem('inventory', { ...item, deleted: true, lastUpdated: now })
    );
  }
  await tx.done;
  requestSync();
}

function recordQueueItem<T extends { id: string }>(
  kind: SharedRecordKind,
  record: T
): SyncQueueItem {
  return {
    id: `record:${kind}:${record.id}`,
    operation: 'put-record',
    kind,
    record,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
}

export async function dbEnqueueRecord<T extends { id: string }>(
  kind: SharedRecordKind,
  record: T
): Promise<void> {
  const db = await getDB();
  await db.put('syncQueue', recordQueueItem(kind, record));
  requestSync();
}

export async function dbListSyncQueue(): Promise<SyncQueueItem[]> {
  const db = await getDB();
  return db.getAllFromIndex('syncQueue', 'by-createdAt');
}

export async function dbDeleteSyncQueueItem(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('syncQueue', id);
}

export async function dbRetrySyncQueueItem(item: SyncQueueItem): Promise<void> {
  const db = await getDB();
  const attempts = item.attempts + 1;
  const delay = Math.min(5 * 60_000, 2 ** Math.min(attempts, 8) * 1_000);
  await db.put('syncQueue', {
    ...item,
    attempts,
    nextAttemptAt: new Date(Date.now() + delay).toISOString(),
  });
}

export async function dbMarkPhotoUploaded(photoId: string): Promise<void> {
  const db = await getDB();
  const photo = await db.get('photoBlobs', photoId);
  if (photo) await db.put('photoBlobs', { ...photo, uploaded: true });
}

export async function dbApplyRemoteInspection(inspection: Inspection): Promise<void> {
  const db = await getDB();
  await db.put('inspections', inspection);
  window.dispatchEvent(new CustomEvent('loadout-data-updated'));
}

export async function dbApplyRemoteInventory(record: InventoryItem & { deleted?: boolean }): Promise<void> {
  const db = await getDB();
  if (record.deleted) await db.delete('inventory', record.id);
  else await db.put('inventory', record);
  window.dispatchEvent(new CustomEvent('loadout-data-updated'));
}
