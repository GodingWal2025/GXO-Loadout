// Device-local persistence. Inspections and photos intentionally remain on the
// warehouse device so capture keeps working without a network connection.

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
}

const DB_NAME = 'loadout';
const DB_VERSION = 4;

let dbPromise: Promise<IDBPDatabase<InspectionDB>> | null = null;

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
        const legacyDb = db as unknown as {
          objectStoreNames: DOMStringList;
          deleteObjectStore(name: string): void;
        };
        if (oldVersion < 4 && legacyDb.objectStoreNames.contains('syncQueue')) {
          // Retired cloud-sync operations are the source of the stale
          // "pending" badge. Removing this store does not touch user data.
          legacyDb.deleteObjectStore('syncQueue');
        }
      },
    });
  }
  return dbPromise;
}

export async function dbSaveInspection(inspection: Inspection): Promise<void> {
  const db = await getDB();
  await db.put('inspections', inspection);
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
  await db.delete('inspections', id);
  window.dispatchEvent(new CustomEvent('loadout-data-updated'));
}

export async function dbArchiveInspection(id: string): Promise<void> {
  const db = await getDB();
  const inspection = await db.get('inspections', id);
  if (!inspection) return;
  await db.put('inspections', { ...inspection, archived: true });
  window.dispatchEvent(new CustomEvent('loadout-data-updated'));
}

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
    uploaded: true,
  });
}

export async function dbGetPhotoBlob(photoId: string): Promise<Blob | undefined> {
  const db = await getDB();
  return (await db.get('photoBlobs', photoId))?.blob;
}

export async function dbSaveInventoryItems(items: InventoryItem[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('inventory', 'readwrite');
  for (const item of items) await tx.store.put(item);
  await tx.done;
}

export async function dbUpdateInventoryItem(item: InventoryItem): Promise<void> {
  const db = await getDB();
  await db.put('inventory', item);
}

export async function dbDeleteInventoryItem(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('inventory', id);
}

export async function dbListInventoryItems(): Promise<InventoryItem[]> {
  const db = await getDB();
  return db.getAll('inventory');
}

export async function dbClearInventory(): Promise<void> {
  const db = await getDB();
  await db.clear('inventory');
}
