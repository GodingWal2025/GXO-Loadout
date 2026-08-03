import { generateId } from '../shared';
import { dbEnqueueRecord } from '../shared/services/db';

export interface StagingLocation {
  id: string;
  name: string;
  siteId: string;
  active: boolean;
  updatedAt?: string;
}

const KEY = 'loadout.stagingLocations';

function loadAll(): StagingLocation[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

function saveAll(locations: StagingLocation[]): void {
  localStorage.setItem(KEY, JSON.stringify(locations));
  window.dispatchEvent(new CustomEvent('loadout-staging-locations-updated'));
}

export function listActiveStagingLocations(siteId: string): StagingLocation[] {
  return loadAll()
    .filter((location) => location.siteId === siteId && location.active)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function listAllStagingLocations(siteId: string): StagingLocation[] {
  return loadAll()
    .filter((location) => location.siteId === siteId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function addStagingLocation(name: string, siteId: string): StagingLocation {
  const location: StagingLocation = {
    id: generateId(),
    name: name.trim(),
    siteId,
    active: true,
    updatedAt: new Date().toISOString(),
  };
  saveAll([...loadAll(), location]);
  void dbEnqueueRecord('staging', location);
  return location;
}

export function updateStagingLocation(id: string, patch: Partial<StagingLocation>): void {
  let updated: StagingLocation | undefined;
  saveAll(
    loadAll().map((location) =>
      location.id === id
        ? (updated = { ...location, ...patch, updatedAt: new Date().toISOString() })
        : location
    )
  );
  if (updated) void dbEnqueueRecord('staging', updated);
}

export function deleteStagingLocation(id: string): void {
  const locations = loadAll();
  const location = locations.find((item) => item.id === id);
  saveAll(locations.filter((item) => item.id !== id));
  if (location) {
    const now = new Date().toISOString();
    void dbEnqueueRecord('staging', { ...location, deleted: true, deletedAt: now, updatedAt: now });
  }
}
