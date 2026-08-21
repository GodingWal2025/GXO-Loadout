import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { PalletLabelGroup } from './types';

interface BagLabelingDb extends DBSchema {
  groups: {
    key: string;
    value: PalletLabelGroup;
    indexes: { 'by-updated': string };
  };
}

const DB_NAME = 'gxo-bag-labeling';
const DB_VERSION = 1;
let database: Promise<IDBPDatabase<BagLabelingDb>> | null = null;

function getDatabase(): Promise<IDBPDatabase<BagLabelingDb>> {
  if (!database) {
    database = openDB<BagLabelingDb>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const groups = db.createObjectStore('groups', { keyPath: 'id' });
        groups.createIndex('by-updated', 'updatedAt');
      },
    });
  }
  return database;
}

export async function listPalletGroups(): Promise<PalletLabelGroup[]> {
  const db = await getDatabase();
  const groups = await db.getAllFromIndex('groups', 'by-updated');
  return groups.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function savePalletGroup(group: PalletLabelGroup): Promise<void> {
  const db = await getDatabase();
  await db.put('groups', { ...group, updatedAt: new Date().toISOString() });
}

export async function deletePalletGroup(id: string): Promise<void> {
  const db = await getDatabase();
  await db.delete('groups', id);
}

export async function clearPalletGroups(): Promise<void> {
  const db = await getDatabase();
  await db.clear('groups');
}
