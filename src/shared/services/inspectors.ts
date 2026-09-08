import { generateId } from '../utils/uuid';
import type { Inspector } from '../types/inspection';
import { dbEnqueueRecord } from './db';

// Inspector reference data stays immediately available in localStorage and is
// mirrored to shared storage so devices at the same site converge over time.
const KEY = 'loadout.inspectors';

function loadAll(): Inspector[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

function saveAll(inspectors: Inspector[]): void {
  localStorage.setItem(KEY, JSON.stringify(inspectors));
  // Admin pickers subscribe to this event instead of sharing React state with
  // the persistence layer.
  window.dispatchEvent(new CustomEvent('loadout-inspectors-updated'));
}

export function listInspectorsForSite(siteId: string): Inspector[] {
  return loadAll()
    .filter((inspector) => inspector.siteId === siteId && inspector.active)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function listAllInspectorsForSite(siteId: string): Inspector[] {
  return loadAll()
    .filter((inspector) => inspector.siteId === siteId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function addInspector(name: string, siteId: string): Inspector {
  const inspectors = loadAll();
  const inspector: Inspector = {
    id: generateId(),
    name: name.trim(),
    siteId,
    active: true,
    updatedAt: new Date().toISOString(),
  };
  saveAll([...inspectors, inspector]);
  void dbEnqueueRecord('inspectors', inspector);
  return inspector;
}

export function updateInspector(id: string, patch: Partial<Inspector>): void {
  let updated: Inspector | undefined;
  saveAll(
    loadAll().map((inspector) =>
      inspector.id === id
        ? (updated = { ...inspector, ...patch, updatedAt: new Date().toISOString() })
        : inspector
    )
  );
  if (updated) void dbEnqueueRecord('inspectors', updated);
}

export function deactivateInspector(id: string): void {
  // Deactivation preserves historical inspector references on old inspections.
  updateInspector(id, { active: false });
}


export function deleteInspector(id: string): void {
  // Hard deletion is intended for unsynced setup mistakes only.
  saveAll(loadAll().filter((inspector) => inspector.id !== id));
}

