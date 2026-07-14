import { generateId } from '../utils/uuid';
// Inspector list service.
//
// Per-site, admin-editable list. Starts empty — managers must add at least
// one inspector per site before any load can be started.

import type { Inspector } from '../types/inspection';

const KEY = 'loadout.inspectors';

function loadAll(): Inspector[] {
  const raw = localStorage.getItem(KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveAll(inspectors: Inspector[]): void {
  localStorage.setItem(KEY, JSON.stringify(inspectors));
}

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
  };
  inspectors.push(newInspector);
  saveAll(inspectors);
  return newInspector;
}

export function updateInspector(id: string, patch: Partial<Inspector>): void {
  const inspectors = loadAll();
  const idx = inspectors.findIndex((i) => i.id === id);
  if (idx !== -1) {
    inspectors[idx] = { ...inspectors[idx], ...patch };
    saveAll(inspectors);
  }
}

export function deactivateInspector(id: string): void {
  updateInspector(id, { active: false });
}
