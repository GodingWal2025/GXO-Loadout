import { generateId } from '../shared';
// Staging Locations service.
//
// Per-site, admin-editable list. Inspector picks from this list at the start
// of an inspection. Examples: "Door 12", "Bay 3-A", "South Yard".
//
// Synced across devices through Cosmos DB (see refSync.ts). Deletes are
// tombstones (deleted: true) rather than hard removals — a hard delete would
// just get resurrected by the next pull from a device that still has the row.

import { createRefSync } from '../shared/services/refSync';

export interface StagingLocation {
  id: string;
  name: string;
  siteId: string;
  active: boolean;
  updatedAt?: string;
  deleted?: boolean;
}

const refSync = createRefSync<StagingLocation>({
  storageKey: 'loadout.stagingLocations',
  listPath: '/api/staging-locations',
  syncPath: '/api/sync-staging-location',
  eventName: 'loadout-staging-locations-updated',
});

const { loadAll, saveAll } = refSync;

export function listActiveStagingLocations(siteId: string): StagingLocation[] {
  return loadAll()
    .filter((l) => l.siteId === siteId && l.active && !l.deleted)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function listAllStagingLocations(siteId: string): StagingLocation[] {
  return loadAll()
    .filter((l) => l.siteId === siteId && !l.deleted)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function addStagingLocation(name: string, siteId: string): StagingLocation {
  const all = loadAll();
  const loc: StagingLocation = {
    id: generateId(),
    name: name.trim(),
    siteId,
    active: true,
    updatedAt: new Date().toISOString(),
  };
  all.push(loc);
  saveAll(all);
  refSync.pushRecord(loc);
  return loc;
}

export function updateStagingLocation(id: string, patch: Partial<StagingLocation>): void {
  const all = loadAll();
  const idx = all.findIndex((l) => l.id === id);
  if (idx !== -1) {
    all[idx] = { ...all[idx], ...patch, updatedAt: new Date().toISOString() };
    saveAll(all);
    refSync.pushRecord(all[idx]);
  }
}

export function deleteStagingLocation(id: string): void {
  // Tombstone instead of hard delete so the deletion propagates to other
  // devices instead of being resurrected by their next push.
  updateStagingLocation(id, { deleted: true, active: false });
}

/** Start the staging locations background sync loop. Safe to call more than once. */
export function startStagingLocationsSync(): void {
  refSync.start();
}

/** One-shot pull/merge/push, for the manual refresh button. */
export function syncStagingLocationsNow(): Promise<void> {
  return refSync.sync();
}
