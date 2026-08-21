/**
 * sync.ts — Shared storage sync engine for GXO Loadout.
 *
 * Implements real-time background sync with:
 * - Two-way replication for inspections, inventory, sites, inspectors, and staging locations
 * - Upload queue for photos with offline persistence
 * - Client-side deterministic conflict resolution (three-way merge)
 * - Adaptive idle backoff (15s active -> up to 120s when idle)
 * - Rich status reporting (last synced timestamp, queue breakdowns, safe-to-close flag)
 */

import {
  dbApplyRemoteInspection,
  dbApplyRemoteInventory,
  dbDeleteSyncQueueItem,
  dbEnqueueRecord,
  dbGetInspection,
  dbGetPhotoBlob,
  dbListAllInspections,
  dbListInventoryItems,
  dbListSyncQueue,
  dbMarkPhotoUploaded,
  dbMakeSyncQueueItemReady,
  dbRetrySyncQueueItem,
  type SharedRecordKind,
  type SyncQueueItem,
} from './db';
import type { Inspection } from '../types/inspection';
import type { InventoryItem } from '../types/inventory';
import { mergeInspection, mergeInventory } from './conflictMerge';

export interface FailedSyncItem {
  id: string;
  type: string;
  error: string;
  nextAttemptAt?: string;
  retryCount: number;
}

export type SyncState = {
  syncing: boolean;
  pending: number;
  pendingRecords: number;
  pendingPhotos: number;
  lastSyncedAt?: string;
  error?: string;
  failedItems?: FailedSyncItem[];
  adaptiveIntervalSeconds?: number;
  isSafeToClose: boolean;
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
// v2 cursors track server receipt time rather than device-authored timestamps.
// Changing the prefix deliberately performs one full pull on existing devices.
const CURSOR_KEY_PREFIX = 'loadout.sync.cursor.v2.';
const LAST_SYNCED_KEY = 'loadout.sync.lastSyncedAt';
const DEVICE_CONFIG_KEY = 'inspection.device.config';
const SYNC_DEVICE_ID_KEY = 'loadout.sync.deviceId.v1';

const MIN_INTERVAL_MS = 15_000;  // 15 seconds active interval
const MAX_INTERVAL_MS = 120_000; // 2 minutes maximum idle backoff

let activeSync: Promise<void> | null = null;
let syncTimeoutId: number | undefined;
let currentIntervalMs = MIN_INTERVAL_MS;

const initialLastSynced = typeof localStorage !== 'undefined' ? localStorage.getItem(LAST_SYNCED_KEY) || undefined : undefined;

let state: SyncState = {
  syncing: false,
  pending: 0,
  pendingRecords: 0,
  pendingPhotos: 0,
  lastSyncedAt: initialLastSynced,
  adaptiveIntervalSeconds: MIN_INTERVAL_MS / 1000,
  isSafeToClose: true,
  failedItems: [],
};

class SyncHttpError extends Error {
  constructor(public status: number, message: string) {
    super(`${message} (${status})`);
  }
}

function emit(patch: Partial<SyncState> = {}): void {
  const isSyncing = patch.syncing !== undefined ? patch.syncing : state.syncing;
  const pendingCount = patch.pending !== undefined ? patch.pending : state.pending;
  const isSafe = !isSyncing && pendingCount === 0;

  state = {
    ...state,
    ...patch,
    adaptiveIntervalSeconds: Math.round(currentIntervalMs / 1000),
    isSafeToClose: isSafe,
  };

  if (state.lastSyncedAt && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(LAST_SYNCED_KEY, state.lastSyncedAt);
    } catch {
      // ignore
    }
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<SyncState>('loadout-sync-status', { detail: state }));
  }
}

export function getSyncState(): SyncState {
  return state;
}

function getActiveSiteId(): string | undefined {
  try {
    const raw = localStorage.getItem(DEVICE_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.siteId) return String(parsed.siteId);
    }
  } catch {
    // ignore
  }
  return undefined;
}

function getDeviceId(): string {
  try {
    const existing = typeof localStorage !== 'undefined'
      ? localStorage.getItem(SYNC_DEVICE_ID_KEY)
      : null;
    if (existing) return existing;

    const generated = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? `device-${crypto.randomUUID()}`
      : `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(SYNC_DEVICE_ID_KEY, generated);
    return generated;
  } catch {
    // ignore
  }
  const host = typeof window !== 'undefined' && (window as any).location?.hostname
    ? (window as any).location.hostname
    : 'client';
  return 'device-web-' + host;
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
  if (typeof localStorage === 'undefined' || localStorage.getItem(MIGRATION_KEY)) return;

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
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CACHE_EVENTS[kind]));
  }
}

async function pushItem(item: SyncQueueItem): Promise<void> {
  const deviceId = getDeviceId();
  const siteId = getActiveSiteId() || '';

  if (item.operation === 'upload-photo') {
    const blob = await dbGetPhotoBlob(item.photoId);
    if (!blob) {
      await dbDeleteSyncQueueItem(item.id);
      return;
    }
    const response = await fetch(`/api/photos/${encodeURIComponent(item.photoId)}`, {
      method: 'POST',
      headers: {
        'content-type': blob.type || 'image/jpeg',
        'x-loadout-device-id': deviceId,
        'x-loadout-site-id': siteId,
      },
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
      headers: {
        'content-type': 'application/json',
        'x-loadout-device-id': deviceId,
        'x-loadout-site-id': siteId,
      },
      body: JSON.stringify(item.record),
    }
  );

  if (response.status === 409) {
    const body = await response.json();
    const remoteRecord = body?.record;
    await dbDeleteSyncQueueItem(item.id);

    if (remoteRecord) {
      if (item.kind === 'inspections') {
        const local = (await dbGetInspection(item.record.id)) || (item.record as Inspection);
        const merged = mergeInspection(local, remoteRecord as Inspection);
        await dbApplyRemoteInspection(merged);
        // Re-enqueue the merged result so changes from both devices persist upstream
        await dbEnqueueRecord('inspections', merged);
      } else if (item.kind === 'inventory') {
        const localItems = await dbListInventoryItems();
        const local = localItems.find((i) => i.id === item.record.id) || (item.record as InventoryItem);
        const merged = mergeInventory(local, remoteRecord as InventoryItem);
        await dbApplyRemoteInventory(merged);
        await dbEnqueueRecord('inventory', merged);
      } else {
        await applyRemote(item.kind, remoteRecord);
      }
    }
    return;
  }

  if (!response.ok) throw new SyncHttpError(response.status, 'Record save failed');
  await dbDeleteSyncQueueItem(item.id);
}

async function pullKind(kind: SharedRecordKind, pendingIds: Set<string>): Promise<number> {
  const siteId = getActiveSiteId();
  const cursorKey = `${CURSOR_KEY_PREFIX}${kind}`;
  const since = typeof localStorage !== 'undefined' ? localStorage.getItem(cursorKey) || '' : '';

  let continuationToken: string | undefined = undefined;
  let totalPulled = 0;
  let syncWatermark: string | undefined = undefined;

  let localById = new Map<string, Record<string, any>>();
  if (kind === 'inspections') {
    localById = new Map((await dbListAllInspections()).map((record) => [record.id, record]));
  } else if (kind === 'inventory') {
    localById = new Map((await dbListInventoryItems()).map((record) => [record.id, record]));
  } else {
    localById = new Map(readCache<Record<string, any>>(CACHE_KEYS[kind]).map((record) => [record.id, record]));
  }

  do {
    const params = new URLSearchParams();
    if (since) params.set('since', since);
    if (siteId && (kind === 'inspections' || kind === 'inventory' || kind === 'staging')) {
      params.set('siteId', siteId);
    }
    if (continuationToken) params.set('continuationToken', continuationToken);
    params.set('limit', '500');

    const response = await fetch(`/api/records/${kind}?${params.toString()}`, {
      headers: {
        accept: 'application/json',
        'x-loadout-device-id': getDeviceId(),
        'x-loadout-site-id': siteId || '',
      },
    });

    if (!response.ok) throw new SyncHttpError(response.status, 'Record download failed');
    const body = await response.json();
    const records: Record<string, any>[] = Array.isArray(body?.resources) ? body.resources : [];
    continuationToken = body?.continuationToken || undefined;
    // Keep the first page's query-start watermark across pagination so a
    // record written between pages is guaranteed to appear on the next poll.
    if (!syncWatermark && body?.serverTime) syncWatermark = body.serverTime;

    for (const record of records) {
      if (!record?.id || pendingIds.has(`record:${kind}:${record.id}`)) continue;
      const local = localById.get(record.id);
      if (!local || timestamp(kind, record) >= timestamp(kind, local)) {
        await applyRemote(kind, record);
        totalPulled++;
      }
    }
  } while (continuationToken);

  if (syncWatermark && typeof localStorage !== 'undefined') {
    localStorage.setItem(cursorKey, syncWatermark);
  }

  return totalPulled;
}

async function performSync(forceRetry = false): Promise<void> {
  await migrateExistingLocalData();
  let queueBefore = await dbListSyncQueue();
  if (forceRetry) {
    await Promise.all(queueBefore.map(dbMakeSyncQueueItemReady));
    queueBefore = await dbListSyncQueue();
  }
  const recordsBefore = queueBefore.filter((item) => item.operation === 'put-record').length;
  const photosBefore = queueBefore.filter((item) => item.operation === 'upload-photo').length;

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    emit({
      syncing: false,
      error: 'Offline',
      pending: queueBefore.length,
      pendingRecords: recordsBefore,
      pendingPhotos: photosBefore,
    });
    return;
  }

  emit({
    syncing: true,
    error: undefined,
    pending: queueBefore.length,
    pendingRecords: recordsBefore,
    pendingPhotos: photosBefore,
  });

  const queue = await dbListSyncQueue();
  const recordItems = queue.filter((item) => item.operation === 'put-record');
  const photoItems = queue.filter((item) => item.operation === 'upload-photo');

  const failedList: FailedSyncItem[] = [];

  for (const item of [...recordItems, ...photoItems]) {
    if (item.nextAttemptAt && item.nextAttemptAt > new Date().toISOString()) {
      failedList.push({
        id: item.id,
        type: item.operation === 'upload-photo' ? 'Photo' : item.kind,
        error: 'Waiting for retry interval',
        nextAttemptAt: item.nextAttemptAt,
        retryCount: item.attempts || 0,
      });
      continue;
    }
    try {
      await pushItem(item);
    } catch (error: any) {
      await dbRetrySyncQueueItem(item);
      console.warn('Shared storage sync retry scheduled', error);
      failedList.push({
        id: item.id,
        type: item.operation === 'upload-photo' ? 'Photo' : item.kind,
        error: error instanceof Error ? error.message : 'Upload failed',
        retryCount: (item.attempts || 0) + 1,
      });
      if (item.operation === 'upload-photo') continue;
      if (!(error instanceof SyncHttpError) || error.status === 401 || error.status >= 500) break;
    }
  }

  const remaining = await dbListSyncQueue();
  const pendingIds = new Set(remaining.map((item) => item.id));
  const kinds: SharedRecordKind[] = ['sites', 'inspectors', 'staging', 'inspections', 'inventory'];

  let pulledChanges = 0;
  const pullFailures: FailedSyncItem[] = [];
  for (const kind of kinds) {
    try {
      pulledChanges += await pullKind(kind, pendingIds);
    } catch (error) {
      console.warn(`Pull failed for kind: ${kind}`, error);
      pullFailures.push({
        id: `pull:${kind}`,
        type: kind,
        error: error instanceof Error ? error.message : 'Download failed',
        retryCount: 0,
      });
    }
  }

  const queueAfter = await dbListSyncQueue();
  const pending = queueAfter.length;
  const pendingRecords = queueAfter.filter((i) => i.operation === 'put-record').length;
  const pendingPhotos = queueAfter.filter((i) => i.operation === 'upload-photo').length;
  const hadChanges = recordItems.length > 0 || photoItems.length > 0 || pulledChanges > 0;

  // Adaptive Idle Backoff: Reset to rapid interval when changes happen; backoff while idle
  if (hadChanges) {
    currentIntervalMs = MIN_INTERVAL_MS;
  } else {
    currentIntervalMs = Math.min(MAX_INTERVAL_MS, Math.round(currentIntervalMs * 1.5));
  }

  emit({
    syncing: false,
    pending,
    pendingRecords,
    pendingPhotos,
    failedItems: [...failedList, ...pullFailures],
    lastSyncedAt: pullFailures.length === 0 ? new Date().toISOString() : state.lastSyncedAt,
    error: pullFailures[0]?.error || (pending ? 'Waiting to retry' : undefined),
  });
}

function scheduleNextAdaptiveSync(): void {
  if (syncTimeoutId) {
    clearTimeout(syncTimeoutId);
  }
  syncTimeoutId = window.setTimeout(async () => {
    try {
      await syncNow();
    } finally {
      scheduleNextAdaptiveSync();
    }
  }, currentIntervalMs);
}

export function syncNow(options: { forceRetry?: boolean } = {}): Promise<void> {
  // Any explicit sync resets interval to active
  currentIntervalMs = MIN_INTERVAL_MS;
  if (!activeSync) {
    activeSync = performSync(options.forceRetry === true)
      .catch(async (error) => {
        const q = await dbListSyncQueue();
        emit({
          syncing: false,
          pending: q.length,
          pendingRecords: q.filter((i) => i.operation === 'put-record').length,
          pendingPhotos: q.filter((i) => i.operation === 'upload-photo').length,
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
  scheduleNextAdaptiveSync();

  const handleVisibility = () => {
    if (document.visibilityState === 'visible') {
      currentIntervalMs = MIN_INTERVAL_MS;
      void syncNow();
    }
  };

  // iPadOS may freeze and later restore a standalone PWA from its page cache.
  // `pageshow` reliably wakes sync even when no focus event is dispatched.
  const handlePageShow = () => {
    currentIntervalMs = MIN_INTERVAL_MS;
    void syncNow();
  };

  const handleSyncRequest = () => {
    currentIntervalMs = MIN_INTERVAL_MS;
    void syncNow();
  };

  window.addEventListener('online', handleSyncRequest);
  window.addEventListener('focus', handleSyncRequest);
  window.addEventListener('visibilitychange', handleVisibility);
  window.addEventListener('pageshow', handlePageShow);
  window.addEventListener('loadout-sync-request', handleSyncRequest);

  return () => {
    window.removeEventListener('online', handleSyncRequest);
    window.removeEventListener('focus', handleSyncRequest);
    window.removeEventListener('visibilitychange', handleVisibility);
    window.removeEventListener('pageshow', handlePageShow);
    window.removeEventListener('loadout-sync-request', handleSyncRequest);
    if (syncTimeoutId) clearTimeout(syncTimeoutId);
  };
}
