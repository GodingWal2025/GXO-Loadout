import { generateId } from '../shared';
// Staging Locations service.
//
// Per-site, admin-editable list. Inspector picks from this list at the start
// of an inspection. Examples: "Door 12", "Bay 3-A", "South Yard".

const KEY = 'loadout.stagingLocations';

export interface StagingLocation {
  id: string;
  name: string;
  siteId: string;
  active: boolean;
}

function loadAll(): StagingLocation[] {
  const raw = localStorage.getItem(KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveAll(locations: StagingLocation[]): void {
  localStorage.setItem(KEY, JSON.stringify(locations));
}

export function listActiveStagingLocations(siteId: string): StagingLocation[] {
  return loadAll()
    .filter((l) => l.siteId === siteId && l.active)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function listAllStagingLocations(siteId: string): StagingLocation[] {
  return loadAll()
    .filter((l) => l.siteId === siteId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function addStagingLocation(name: string, siteId: string): StagingLocation {
  const all = loadAll();
  const loc: StagingLocation = {
    id: generateId(),
    name: name.trim(),
    siteId,
    active: true,
  };
  all.push(loc);
  saveAll(all);
  return loc;
}

export function updateStagingLocation(id: string, patch: Partial<StagingLocation>): void {
  const all = loadAll();
  const idx = all.findIndex((l) => l.id === id);
  if (idx !== -1) {
    all[idx] = { ...all[idx], ...patch };
    saveAll(all);
  }
}

export function deleteStagingLocation(id: string): void {
  const all = loadAll();
  saveAll(all.filter((l) => l.id !== id));
}
