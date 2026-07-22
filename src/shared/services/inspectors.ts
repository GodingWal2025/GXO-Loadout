import { generateId } from '../utils/uuid';
// Inspector list service.
//
// Per-site, admin-editable list. Starts empty — managers must add at least
// one inspector per site before any load can be started.
//
// Synced across devices through Cosmos DB (see refSync.ts): every write is
// stamped with updatedAt and pushed; a 30s background loop pulls records
// created on other devices.

import type { Inspector } from '../types/inspection';
import { createRefSync } from './refSync';

const refSync = createRefSync<Inspector>({
  storageKey: 'loadout.inspectors',
  listPath: '/api/inspectors',
  syncPath: '/api/sync-inspector',
  eventName: 'loadout-inspectors-updated',
});

const { loadAll, saveAll } = refSync;

export function listInspectorsForSite(siteId: string): Inspector[] {
  return loadAll()
    .filter((i) => i.siteId === siteId && i.active)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function listAllInspectorsForSite(siteId: string): Inspector[] {
  return loadAll()
    .filter((i) => i.siteId === siteId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function addInspector(name: string, siteId: string): Inspector {
  const inspectors = loadAll();
  const newInspector: Inspector = {
    id: generateId(),
    name: name.trim(),
    siteId,
    active: true,
    updatedAt: new Date().toISOString(),
  };
  inspectors.push(newInspector);
  saveAll(inspectors);
  refSync.pushRecord(newInspector);
  return newInspector;
}

export function updateInspector(id: string, patch: Partial<Inspector>): void {
  const inspectors = loadAll();
  const idx = inspectors.findIndex((i) => i.id === id);
  if (idx !== -1) {
    inspectors[idx] = { ...inspectors[idx], ...patch, updatedAt: new Date().toISOString() };
    saveAll(inspectors);
    refSync.pushRecord(inspectors[idx]);
  }
}

export function deactivateInspector(id: string): void {
  updateInspector(id, { active: false });
}

/** Start the inspectors background sync loop. Safe to call more than once. */
export function startInspectorsSync(): void {
  refSync.start();
}

/** One-shot pull/merge/push, for the manual refresh button. */
export function syncInspectorsNow(): Promise<void> {
  return refSync.sync();
}
