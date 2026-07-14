import { generateId } from '../shared';
// Sites service - admin-managed list.
//
// Starts empty after install. Admin adds sites via the Sites tab.

import type { Site } from '../shared';

const KEY = 'loadout.sites';

function loadAll(): Site[] {
  const raw = localStorage.getItem(KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveAll(sites: Site[]): void {
  localStorage.setItem(KEY, JSON.stringify(sites));
}

export function listActiveSites(): Site[] {
  return loadAll()
    .filter((s) => s.active)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function listAllSites(): Site[] {
  return loadAll().sort((a, b) => a.name.localeCompare(b.name));
}

export function findSite(siteId: string): Site | undefined {
  return loadAll().find((s) => s.id === siteId);
}

export function addSite(name: string, address?: string): Site {
  const sites = loadAll();
  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32) || generateId().slice(0, 8);

  let finalId = id;
  let suffix = 1;
  while (sites.some((s) => s.id === finalId)) {
    suffix++;
    finalId = `${id}-${suffix}`;
  }

  const site: Site = {
    id: finalId,
    name: name.trim(),
    address: address?.trim() || undefined,
    active: true,
    createdAt: new Date().toISOString(),
  };
  sites.push(site);
  saveAll(sites);
  return site;
}

export function updateSite(id: string, patch: Partial<Site>): void {
  const sites = loadAll();
  const idx = sites.findIndex((s) => s.id === id);
  if (idx !== -1) {
    sites[idx] = { ...sites[idx], ...patch };
    saveAll(sites);
  }
}

export function deleteSite(id: string): { ok: boolean; reason?: string } {
  const sites = loadAll();
  const target = sites.find((s) => s.id === id);
  if (!target) return { ok: false, reason: 'Site not found' };

  // Don't allow deleting the currently-assigned site
  const deviceConfig = localStorage.getItem('inspection.device.config');
  if (deviceConfig) {
    try {
      const parsed = JSON.parse(deviceConfig);
      if (parsed.siteId === id) {
        return {
          ok: false,
          reason: 'This site is currently the selected site. Reassign the device to a different site before deleting.',
        };
      }
    } catch {
      // ignore
    }
  }

  saveAll(sites.filter((s) => s.id !== id));
  return { ok: true };
}
