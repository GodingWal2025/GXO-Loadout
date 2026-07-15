// IndexedDB persistence layer.
//
// localStorage isn't viable for this app because photos are large binary blobs
// (~500KB-2MB each), and a single inspection can have 80+ photos. IndexedDB
// handles gigabytes and supports binary data natively.
//
// Stores:
//   inspections      - inspection records (JSON), keyed by id
//   photoBlobs       - photo binary data, keyed by photoId, with inspectionId index
//   syncQueue        - pending operations to push to SharePoint when online

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Inspection } from '../types/inspection';

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
  syncQueue: {
    key: number;
    value: SyncQueueEntry;
    indexes: { 'by-status': string };
  };
}

export interface SyncQueueEntry {
  id?: number;
  type: 'inspection-save' | 'inspection-complete' | 'photo-upload';
  inspectionId: string;
  photoId?: string;
  payload?: any;
  attempts: number;
  lastAttemptAt?: string;
  lastError?: string;
  status: 'pending' | 'in-progress' | 'failed' | 'done';
  createdAt: string;
}

const DB_NAME = 'loadout';
const DB_VERSION = 2;

// Cap on automatic retries so a permanently-bad record eventually stops
// hammering the server instead of being retried forever.
export const MAX_SYNC_ATTEMPTS = 5;

let dbPromise: Promise<IDBPDatabase<InspectionDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<InspectionDB>> {
  if (!dbPromise) {
    dbPromise = openDB<InspectionDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
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
        if (!db.objectStoreNames.contains('syncQueue')) {
          const store = db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
          store.createIndex('by-status', 'status');
        }
      },
    });
  }
  return dbPromise;
}

// ---- Inspections ----

export async function dbSaveInspection(inspection: Inspection): Promise<void> {
  const db = await getDB();
  await db.put('inspections', inspection);
  dbEnqueueSync({
    type: inspection.status === 'COMPLETED' || inspection.status === 'FLAGGED' ? 'inspection-complete' : 'inspection-save',
    inspectionId: inspection.id
  }).catch(e => console.error("dbEnqueueSync error", e));
}

// Same as dbSaveInspection, but doesn't enqueue a sync back to the server
export async function upsertDownloadedInspection(inspection: Inspection): Promise<void> {
  const db = await getDB();
  const existing = await db.get('inspections', inspection.id);
  // Simple conflict resolution: if we have local changes, don't overwrite
  // (In a real app, you might compare lastEditedAt timestamps or use a sync status flag)
  if (existing && new Date(existing.lastEditedAt || 0) >= new Date(inspection.lastEditedAt || 0)) {
    return;
  }
  await db.put('inspections', inspection);
}

export async function dbGetInspection(id: string): Promise<Inspection | undefined> {
  const db = await getDB();
  return db.get('inspections', id);
}

export async function dbListAllInspections(): Promise<Inspection[]> {
  const db = await getDB();
  return db.getAll('inspections');
}

export async function dbListInspectionsForSite(siteId: string): Promise<Inspection[]> {
  const db = await getDB();
  const results = await db.getAllFromIndex('inspections', 'by-site', siteId);
  return results.filter((i) => !i.archived).sort((a, b) => (b.lastEditedAt || '').localeCompare(a.lastEditedAt || ''));
}

export async function dbListInProgressForSite(siteId: string): Promise<Inspection[]> {
  const all = await dbListInspectionsForSite(siteId);
  return all.filter((i) => i.status === 'PENDING' || i.status === 'IN_PROGRESS');
}

export async function dbListCompletedForSite(siteId: string): Promise<Inspection[]> {
  const all = await dbListInspectionsForSite(siteId);
  return all.filter((i) => i.status === 'COMPLETED' || i.status === 'FLAGGED');
}

export async function dbHardDeleteInspection(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('inspections', id);
}

export async function dbArchiveInspection(id: string): Promise<void> {
  const db = await getDB();
  const ins = await db.get('inspections', id);
  if (ins) {
    ins.archived = true;
    await db.put('inspections', ins);
    await dbEnqueueSync({
      type: 'inspection-save',
      inspectionId: ins.id,
      payload: ins,
    });
  }
}

// ---- Photo blobs ----

export async function dbSavePhotoBlob(
  photoId: string,
  inspectionId: string,
  blob: Blob
): Promise<void> {
  const db = await getDB();
  await db.put('photoBlobs', {
    photoId,
    inspectionId,
    blob,
    capturedAt: new Date().toISOString(),
    uploaded: false,
  });
  await dbEnqueueSync({
    type: 'photo-upload',
    inspectionId,
    photoId
  });
}

export async function dbGetPhotoBlob(photoId: string): Promise<Blob | undefined> {
  const db = await getDB();
  const record = await db.get('photoBlobs', photoId);
  return record?.blob;
}

export async function dbMarkPhotoUploaded(photoId: string): Promise<void> {
  const db = await getDB();
  const record = await db.get('photoBlobs', photoId);
  if (record) {
    record.uploaded = true;
    await db.put('photoBlobs', record);
  }
}

// ---- Sync queue ----

export async function dbEnqueueSync(entry: Omit<SyncQueueEntry, 'id' | 'createdAt' | 'attempts' | 'status'>): Promise<number> {
  const db = await getDB();
  const tx = db.transaction('syncQueue', 'readwrite');

  // Deduplicate pending updates for the same inspection
  if (entry.type === 'inspection-save' || entry.type === 'inspection-complete') {
    const allPending = await tx.store.index('by-status').getAll('pending');
    for (const record of allPending) {
      if (
        record.inspectionId === entry.inspectionId &&
        (record.type === 'inspection-save' || record.type === 'inspection-complete') &&
        record.id !== undefined
      ) {
        await tx.store.delete(record.id);
      }
    }
  }

  const resultPromise = tx.store.add({
    ...entry,
    attempts: 0,
    status: 'pending',
    createdAt: new Date().toISOString(),
  });

  await tx.done;
  return resultPromise as Promise<number>;
}

export async function dbGetPendingSync(): Promise<SyncQueueEntry[]> {
  const db = await getDB();
  return db.getAllFromIndex('syncQueue', 'by-status', 'pending');
}

/**
 * Resurrect entries that would otherwise be stranded so the sync loop can
 * retry them:
 *   - 'failed'      — a previous push errored (e.g. the API was down). These
 *                     were never retried because the queue only processed
 *                     'pending' entries, so any inspection created while the
 *                     backend was unavailable stayed local forever.
 *   - 'in-progress' — orphaned when a tab closed mid-sync; also never retried.
 *
 * Entries that have already burned through MAX_SYNC_ATTEMPTS are left as
 * 'failed' so a genuinely bad record stops retrying. Returns the number of
 * entries moved back to 'pending'.
 */
export async function dbRequeueStalledSync(): Promise<number> {
  const db = await getDB();
  const tx = db.transaction('syncQueue', 'readwrite');
  const all = await tx.store.getAll();
  let requeued = 0;
  for (const entry of all) {
    if (entry.id === undefined) continue;
    const isRetriableFailure = entry.status === 'failed' && entry.attempts < MAX_SYNC_ATTEMPTS;
    const isOrphanedInProgress = entry.status === 'in-progress';
    if (isRetriableFailure || isOrphanedInProgress) {
      entry.status = 'pending';
      await tx.store.put(entry);
      requeued++;
    }
  }
  await tx.done;
  return requeued;
}

export async function dbUpdateSyncEntry(entry: SyncQueueEntry): Promise<void> {
  const db = await getDB();
  await db.put('syncQueue', entry);
}

// ---- Stats ----

export async function dbGetPendingSyncCount(): Promise<number> {
  const db = await getDB();
  return db.countFromIndex('syncQueue', 'by-status', 'pending');
}

export async function dbGetUnuploadedPhotoCount(): Promise<number> {
  const db = await getDB();
  const all = await db.getAll('photoBlobs');
  return all.filter((p) => !p.uploaded).length;
}
