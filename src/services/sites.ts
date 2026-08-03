import { generateId, type Site } from '../shared';
import { dbEnqueueRecord } from '../shared/services/db';

const KEY = 'loadout.sites';

function loadAll(): Site[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

function saveAll(sites: Site[]): void {
  localStorage.setItem(KEY, JSON.stringify(sites));
  window.dispatchEvent(new CustomEvent('loadout-sites-updated'));
}

export function listActiveSites(): Site[] {
  return loadAll().filter((site) => site.active).sort((a, b) => a.name.localeCompare(b.name));
}

export function listAllSites(): Site[] {
  return loadAll().sort((a, b) => a.name.localeCompare(b.name));
}

export function findSite(siteId: string): Site | undefined {
  return loadAll().find((site) => site.id === siteId);
}

export function addSite(name: string, address?: string): Site {
  const sites = loadAll();
  const baseId =
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) ||
    generateId().slice(0, 8);
  let id = baseId;
  let suffix = 1;
  while (sites.some((site) => site.id === id)) id = `${baseId}-${++suffix}`;

  const site: Site = {
    id,
    name: name.trim(),
    address: address?.trim() || undefined,
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveAll([...sites, site]);
  void dbEnqueueRecord('sites', site);
  return site;
}

export function updateSite(id: string, patch: Partial<Site>): void {
  let updated: Site | undefined;
  saveAll(loadAll().map((site) => {
    if (site.id !== id) return site;
    updated = { ...site, ...patch, updatedAt: new Date().toISOString() };
    return updated;
  }));
  if (updated) void dbEnqueueRecord('sites', updated);
}

export function deleteSite(id: string): { ok: boolean; reason?: string } {
  const sites = loadAll();
  if (!sites.some((site) => site.id === id)) return { ok: false, reason: 'Site not found' };

  try {
    const config = JSON.parse(localStorage.getItem('inspection.device.config') || 'null');
    if (config?.siteId === id) {
      return {
        ok: false,
        reason: 'This site is selected on this device. Reassign the device before deleting it.',
      };
    }
  } catch {
    // A malformed legacy device config should not prevent cleanup.
  }

  const site = sites.find((item) => item.id === id)!;
  const now = new Date().toISOString();
  saveAll(sites.filter((item) => item.id !== id));
  void dbEnqueueRecord('sites', { ...site, deleted: true, deletedAt: now, updatedAt: now });
  return { ok: true };
}
