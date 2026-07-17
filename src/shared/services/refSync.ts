// Generic cloud sync for small localStorage-backed reference lists
// (inspectors, staging locations). Mirrors the sites sync, but with a
// timestamp-based merge so edits/deactivations propagate in the right
// direction instead of a blind cloud-wins that can resurrect stale records.
//
// Records need an `id`; `updatedAt` is stamped by the owning service on every
// write. A record without `updatedAt` is treated as ancient (epoch) so any
// real edit beats it.

export interface RefRecord {
  id: string;
  updatedAt?: string;
}

const EPOCH = '1970-01-01T00:00:00.000Z';

function ts(r: { updatedAt?: string } | undefined): string {
  return r?.updatedAt || EPOCH;
}

/** Remove Cosmos DB metadata (_rid, _etag, _ts, …) from a pulled record. */
function stripCosmosMeta<T extends RefRecord>(r: any): T {
  const out: any = {};
  for (const k of Object.keys(r)) {
    if (!k.startsWith('_')) out[k] = r[k];
  }
  return out as T;
}

export interface RefSync<T extends RefRecord> {
  loadAll: () => T[];
  saveAll: (records: T[]) => void;
  /** Fire-and-forget push of a single record to the cloud. */
  pushRecord: (record: T) => void;
  /** Pull + merge + push anything the cloud is missing. Safe to re-run. */
  sync: () => Promise<void>;
  /** Start the background loop (initial sync, 30s interval, online/visible). */
  start: () => void;
}

export function createRefSync<T extends RefRecord>(opts: {
  storageKey: string;   // localStorage key, e.g. 'loadout.inspectors'
  listPath: string;     // GET endpoint, e.g. '/api/inspectors'
  syncPath: string;     // POST endpoint, e.g. '/api/sync-inspector'
  eventName: string;    // window event fired after a merge changes local data
}): RefSync<T> {
  const { storageKey, listPath, syncPath, eventName } = opts;

  function loadAll(): T[] {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  function saveAll(records: T[]): void {
    localStorage.setItem(storageKey, JSON.stringify(records));
  }

  async function pushRecordAsync(record: T): Promise<void> {
    try {
      await fetch(syncPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
      });
    } catch {
      // Best-effort; sync() re-pushes on the next cycle.
    }
  }

  async function sync(): Promise<void> {
    let cloud: T[] = [];
    try {
      // no-store: iOS Safari otherwise serves a stale cached GET.
      const res = await fetch(listPath, { cache: 'no-store' });
      if (!res.ok) return;
      const { resources } = await res.json();
      if (!Array.isArray(resources)) return;
      cloud = resources
        .filter((r: any) => r && typeof r.id === 'string')
        .map((r: any) => stripCosmosMeta<T>(r));
    } catch {
      return; // offline; retried next cycle
    }

    // Merge: newer updatedAt wins in both directions.
    const byId = new Map<string, T>(loadAll().map((r) => [r.id, r]));
    let changed = false;
    for (const c of cloud) {
      const local = byId.get(c.id);
      if (!local || ts(c) > ts(local)) {
        byId.set(c.id, c);
        changed = true;
      }
    }
    const merged = [...byId.values()];
    if (changed) {
      saveAll(merged);
      window.dispatchEvent(new CustomEvent(eventName));
    }

    // Push records the cloud is missing or has an older version of.
    const cloudById = new Map(cloud.map((c) => [c.id, c]));
    for (const m of merged) {
      const c = cloudById.get(m.id);
      if (!c || ts(m) > ts(c)) {
        await pushRecordAsync(m);
      }
    }
  }

  let started = false;
  function start(): void {
    if (started) return;
    started = true;
    void sync();
    setInterval(() => void sync(), 30_000);
    window.addEventListener('online', () => void sync());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void sync();
    });
  }

  return {
    loadAll,
    saveAll,
    pushRecord: (r) => void pushRecordAsync(r),
    sync,
    start,
  };
}
