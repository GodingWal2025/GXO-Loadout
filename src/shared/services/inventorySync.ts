// Cloud sync for the inventory list (SKU / batch / material description).
//
// Inventory lives in IndexedDB and is used to resolve material descriptions on
// the review screen and PDF. Previously it was local-only, so a device that
// never imported the Excel saw blank descriptions. This syncs it to a Cosmos
// ref container so any device pulls the same inventory automatically.
//
// Records use a stable id (`${sku}_${batch}`) and a `lastUpdated` timestamp;
// newer lastUpdated wins in a merge. Unlike the small inspector/staging lists,
// inventory can be ~1-2k rows, so it's pushed as one bulk batch.

import { dbListInventoryItems, dbSaveInventoryItems } from './db';
import type { InventoryItem } from '../types/inventory';

const LIST_PATH = '/api/inventory';
const SYNC_PATH = '/api/sync-inventory';
const EPOCH = '1970-01-01T00:00:00.000Z';

function ts(r: { lastUpdated?: string } | undefined): string {
  return r?.lastUpdated || EPOCH;
}

function stripCosmosMeta(r: any): InventoryItem {
  const out: any = {};
  for (const k of Object.keys(r)) {
    if (!k.startsWith('_')) out[k] = r[k];
  }
  return out as InventoryItem;
}

/** Fire-and-forget bulk push of inventory rows to the cloud. */
export async function pushInventory(items: InventoryItem[]): Promise<void> {
  if (!items.length) return;
  try {
    await fetch(SYNC_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
  } catch {
    // Best-effort; syncInventory() re-pushes on the next cycle.
  }
}

/** Pull cloud inventory, merge into IndexedDB, and push anything missing. */
export async function syncInventory(): Promise<void> {
  let cloud: InventoryItem[] = [];
  try {
    // no-store: iOS Safari otherwise serves a stale cached GET.
    const res = await fetch(LIST_PATH, { cache: 'no-store' });
    if (!res.ok) return;
    const { resources } = await res.json();
    if (!Array.isArray(resources)) return;
    cloud = resources
      .filter((r: any) => r && typeof r.id === 'string')
      .map(stripCosmosMeta);
  } catch {
    return; // offline; retried next cycle
  }

  const local = await dbListInventoryItems();
  const byId = new Map<string, InventoryItem>(local.map((r) => [r.id, r]));

  // Merge: newer lastUpdated wins.
  const toSave: InventoryItem[] = [];
  for (const c of cloud) {
    const l = byId.get(c.id);
    if (!l || ts(c) > ts(l)) {
      byId.set(c.id, c);
      toSave.push(c);
    }
  }
  if (toSave.length) {
    await dbSaveInventoryItems(toSave);
    window.dispatchEvent(new CustomEvent('loadout-inventory-updated'));
  }

  // Push rows the cloud is missing or has an older version of.
  const cloudById = new Map(cloud.map((c) => [c.id, c]));
  const toPush = [...byId.values()].filter((m) => {
    const c = cloudById.get(m.id);
    return !c || ts(m) > ts(c);
  });
  if (toPush.length) await pushInventory(toPush);
}

let started = false;
/** Start the background loop: initial sync, 5 min interval, online/visible. */
export function startInventorySync(): void {
  if (started) return;
  started = true;
  void syncInventory();
  // Inventory changes rarely, so a slower cadence than the ref lists is fine.
  setInterval(() => void syncInventory(), 300_000);
  window.addEventListener('online', () => void syncInventory());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncInventory();
  });
}
