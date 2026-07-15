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
  void pushSiteToServer(site);
  return site;
}

export function updateSite(id: string, patch: Partial<Site>): void {
  const sites = loadAll();
  const idx = sites.findIndex((s) => s.id === id);
  if (idx !== -1) {
    sites[idx] = { ...sites[idx], ...patch };
    saveAll(sites);
    void pushSiteToServer(sites[idx]);
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

// ── Cloud sync ─────────────────────────────────────────────
// Sites are shared reference data. They live in localStorage (admin-editable),
// but must also propagate across devices — otherwise a freshly-configured iPad
// has no sites and can't display the inspections that were synced for them.

async function pushSiteToServer(site: Site): Promise<void> {
  try {
    await fetch('/api/sync-site', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(site),
    });
  } catch {
    // Best-effort; startSitesSync() re-pushes local sites on a later cycle.
  }
}

/** Upsert every locally-known site to the cloud (idempotent). Lets a device
 *  that created sites before sync existed seed them for everyone else. */
export async function pushAllLocalSitesToServer(): Promise<void> {
  for (const site of loadAll()) {
    await pushSiteToServer(site);
  }
}

/** Merge the cloud site list into localStorage. Cloud entries win on conflict;
 *  local-only sites are kept (and get pushed up by pushAllLocalSitesToServer). */
export async function pullSitesFromServer(): Promise<void> {
  try {
    // no-store: iOS Safari otherwise serves a stale cached GET.
    const res = await fetch('/api/sites', { cache: 'no-store' });
    if (!res.ok) return;
    const { resources } = await res.json();
    if (!Array.isArray(resources)) return;

    const byId = new Map<string, Site>(loadAll().map((s) => [s.id, s]));
    let changed = false;
    for (const r of resources) {
      if (!r || typeof r.id !== 'string') continue;
      const merged: Site = {
        id: r.id,
        name: typeof r.name === 'string' ? r.name : r.id,
        address: r.address || undefined,
        active: r.active !== false,
        createdAt: r.createdAt || new Date().toISOString(),
      };
      if (JSON.stringify(byId.get(r.id)) !== JSON.stringify(merged)) {
        byId.set(r.id, merged);
        changed = true;
      }
    }
    if (changed) {
      saveAll([...byId.values()]);
      // Let the setup screen / admin site list refresh live.
      window.dispatchEvent(new CustomEvent('loadout-sites-updated'));
    }
  } catch {
    // ignore; retried on the next cycle
  }
}

let sitesSyncStarted = false;

/** Start syncing the site list. Safe to call more than once. */
export function startSitesSync(): void {
  if (sitesSyncStarted) return;
  sitesSyncStarted = true;

  const sync = () => {
    // Seed the cloud with anything only this device knows, then learn about
    // sites created on other devices.
    void pushAllLocalSitesToServer().finally(() => void pullSitesFromServer());
  };

  sync();
  setInterval(() => void pullSitesFromServer(), 30_000);
  window.addEventListener('online', sync);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sync();
  });
}
