import type { Inspection } from '../types/inspection';
import type { InventoryItem } from '../types/inventory';
import {
  dbApplyRemoteInspection,
  dbApplyRemoteInventory,
  dbDeleteSyncQueueItem,
  dbEnqueueRecord,
  dbGetPhotoBlob,
  dbListAllInspections,
  dbListInventoryItems,
  dbListSyncQueue,
  dbMarkPhotoUploaded,
  dbRetrySyncQueueItem,
  type SharedRecordKind,
  type SyncQueueItem,
} from './db';

export type SyncState = {
  syncing: boolean;
  pending: number;
  lastSyncedAt?: string;
  error?: string;
};

const CACHE_KEYS: Record<Exclude<SharedRecordKind, 'inspections' | 'inventory'>, string> = {
  sites: 'loadout.sites',
  inspectors: 'loadout.inspectors',
  staging: 'loadout.stagingLocations',
};
const CACHE_EVENTS: Record<keyof typeof CACHE_KEYS, string> = {
  sites: 'loadout-sites-updated',
  inspectors: 'loadout-inspectors-updated',
  staging: 'loadout-staging-locations-updated',
};
const MIGRATION_KEY = 'loadout.shared-storage.migrated.v1';

let activeSync: Promise<void> | null = null;
let timer: number | undefined;
let state: SyncState = { syncing: false, pending: 0 };

class SyncHttpError extends Error {
  constructor(public status: number, message: string) {
    super(`${message} (${status})`);
  }
}

function emit(patch: Partial<SyncState> = {}): void {
  state = { ...state, ...patch };
  window.dispatchEvent(new CustomEvent<SyncState>('loadout-sync-status', { detail: state }));
}

export function getSyncState(): SyncState {
  return state;
}

function timestamp(kind: SharedRecordKind, record: Record<string, any>): string {
  if (kind === 'inspections') return record.lastEditedAt || record.completedAt || record.startedAt || '';
  if (kind === 'inventory') return record.lastUpdated || '';
  return record.updatedAt || record.createdAt || '';
}

function readCache<T>(key: string): T[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

async function migrateExistingLocalData(): Promise<void> {
  if (localStorage.getItem(MIGRATION_KEY)) return;

  const inspections = await dbListAllInspections();
  const inventory = await dbListInventoryItems();
  for (const record of inspections) await dbEnqueueRecord('inspections', record);
  for (const record of inventory) await dbEnqueueRecord('inventory', record);
  for (const [kind, key] of Object.entries(CACHE_KEYS) as Array<[keyof typeof CACHE_KEYS, string]>) {
    for (const record of readCache<Record<string, unknown> & { id: string }>(key)) {
      await dbEnqueueRecord(kind, record);
    }
  }
  localStorage.setItem(MIGRATION_KEY, new Date().toISOString());
}

async function applyRemote(kind: SharedRecordKind, record: Record<string, any>): Promise<void> {
  if (kind === 'inspections') {
    await dbApplyRemoteInspection(record as Inspection);
    return;
  }
  if (kind === 'inventory') {
    await dbApplyRemoteInventory(record as InventoryItem & { deleted?: boolean });
    return;
  }

  const key = CACHE_KEYS[kind];
  const existing = readCache<Record<string, any>>(key);
  const next = record.deleted
    ? existing.filter((item) => item.id !== record.id)
    : [...existing.filter((item) => item.id !== record.id), record];
  localStorage.setItem(key, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(CACHE_EVENTS[kind]));
}

async function pushItem(item: SyncQueueItem): Promise<void> {
  if (item.operation === 'upload-photo') {
    const blob = await dbGetPhotoBlob(item.photoId);
    if (!blob) {
      await dbDeleteSyncQueueItem(item.id);
      return;
    }
    const response = await fetch(`/api/photos/${encodeURIComponent(item.photoId)}`, {
      method: 'POST',
      headers: { 'content-type': blob.type || 'image/jpeg' },
      body: blob,
    });
    if (!response.ok) throw new SyncHttpError(response.status, 'Photo upload failed');
    await dbMarkPhotoUploaded(item.photoId);
    await dbDeleteSyncQueueItem(item.id);
    return;
  }

  const response = await fetch(
    `/api/records/${item.kind}/${encodeURIComponent(item.record.id)}`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(item.record),
    }
  );
  if (response.status === 409) {
    const body = await response.json();
    if (body?.record) await applyRemote(item.kind, body.record);
    await dbDeleteSyncQueueItem(item.id);
    return;
  }
  if (!response.ok) throw new SyncHttpError(response.status, 'Record save failed');
  await dbDeleteSyncQueueItem(item.id);
}

async function pullKind(kind: SharedRecordKind, pendingIds: Set<string>): Promise<void> {
  const response = await fetch(`/api/records/${kind}`, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new SyncHttpError(response.status, 'Record download failed');
  const body = await response.json();
  const records: Record<string, any>[] = Array.isArray(body?.resources) ? body.resources : [];

  let localById = new Map<string, Record<string, any>>();
  if (kind === 'inspections') {
    localById = new Map((await dbListAllInspections()).map((record) => [record.id, record]));
  } else if (kind === 'inventory') {
    localById = new Map((await dbListInventoryItems()).map((record) => [record.id, record]));
  } else {
    localById = new Map(readCache<Record<string, any>>(CACHE_KEYS[kind]).map((record) => [record.id, record]));
  }

  for (const record of records) {
    if (!record?.id || pendingIds.has(`record:${kind}:${record.id}`)) continue;
    const local = localById.get(record.id);
    if (!local || timestamp(kind, record) >= timestamp(kind, local)) await applyRemote(kind, record);
  }
}

async function performSync(): Promise<void> {
  if (!navigator.onLine) {
    emit({ syncing: false, error: 'Offline', pending: (await dbListSyncQueue()).length });
    return;
  }

  await migrateExistingLocalData();
  emit({ syncing: true, error: undefined, pending: (await dbListSyncQueue()).length });
  const queue = await dbListSyncQueue();
  for (const item of queue) {
    if (item.nextAttemptAt && item.nextAttemptAt > new Date().toISOString()) continue;
    try {
      await pushItem(item);
    } catch (error) {
      await dbRetrySyncQueueItem(item);
      console.warn('Shared storage sync retry scheduled', error);
      // Authentication, network, and server failures affect every queued item;
      // do not hammer the endpoint once per record (especially after inventory imports).
      if (!(error instanceof SyncHttpError) || error.status === 401 || error.status >= 500) break;
    }
  }

  const remaining = await dbListSyncQueue();
  const pendingIds = new Set(remaining.map((item) => item.id));
  const kinds: SharedRecordKind[] = ['sites', 'inspectors', 'staging', 'inspections', 'inventory'];
  for (const kind of kinds) await pullKind(kind, pendingIds);
  const pending = (await dbListSyncQueue()).length;
  emit({ syncing: false, pending, lastSyncedAt: new Date().toISOString(), error: pending ? 'Waiting to retry' : undefined });
}

export function syncNow(): Promise<void> {
  if (!activeSync) {
    activeSync = performSync()
      .catch(async (error) => {
        emit({
          syncing: false,
          pending: (await dbListSyncQueue()).length,
          error: error instanceof Error ? error.message : 'Sync failed',
        });
      })
      .finally(() => {
        activeSync = null;
      });
  }
  return activeSync;
}

export function startSharedStorageSync(): () => void {
  void syncNow();
  const handleVisibility = () => {
    if (document.visibilityState === 'visible') void syncNow();
  };
  window.addEventListener('online', syncNow);
  window.addEventListener('focus', syncNow);
  window.addEventListener('visibilitychange', handleVisibility);
  window.addEventListener('loadout-sync-request', syncNow);
  timer = window.setInterval(() => void syncNow(), 5_000);
  return () => {
    window.removeEventListener('online', syncNow);
    window.removeEventListener('focus', syncNow);
    window.removeEventListener('visibilitychange', handleVisibility);
    window.removeEventListener('loadout-sync-request', syncNow);
    if (timer) window.clearInterval(timer);
  };
}
