import { generateId } from '../utils/uuid';
import type { Inspector } from '../types/inspection';
import { dbEnqueueRecord } from './db';

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
  updateInspector(id, { active: false });
}
