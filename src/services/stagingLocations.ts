import { generateId } from '../shared';

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
  return location;
}

export function updateStagingLocation(id: string, patch: Partial<StagingLocation>): void {
  saveAll(
    loadAll().map((location) =>
      location.id === id
        ? { ...location, ...patch, updatedAt: new Date().toISOString() }
        : location
    )
  );
}

export function deleteStagingLocation(id: string): void {
  saveAll(loadAll().filter((location) => location.id !== id));
}
