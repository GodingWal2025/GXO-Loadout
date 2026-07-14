// App reset mechanism.
//
// Two modes:
//   1. Automatic: when DATA_VERSION is bumped, the next launch wipes all
//      localStorage and IndexedDB to ensure no stale data from older app
//      versions persists. Useful when the schema changes or for a clean reset
//      after major changes.
//   2. Manual: admin can trigger a reset from the Security tab.
//
// Bump DATA_VERSION whenever the data schema changes incompatibly or when you
// want all existing installs to start fresh.

const DATA_VERSION = '2';
const VERSION_KEY = 'loadout.data.version';

/**
 * Check if we need to wipe data, and do so if needed.
 * Call this at the very top of main.tsx, before any other localStorage/IDB access.
 */
export async function runResetIfNeeded(): Promise<void> {
  const stored = localStorage.getItem(VERSION_KEY);
  if (stored === DATA_VERSION) return;

  console.log(`[loadout] Data version mismatch (stored=${stored}, current=${DATA_VERSION}). Wiping data.`);
  await wipeAllData();
  localStorage.setItem(VERSION_KEY, DATA_VERSION);
}

/**
 * Wipe all persistent app data. Used by manual admin reset.
 */
export async function wipeAllData(): Promise<void> {
  // Clear localStorage (except the data version key, which we manage separately)
  const keys = Object.keys(localStorage);
  for (const key of keys) {
    if (key.startsWith('loadout.') || key.startsWith('inspection.')) {
      localStorage.removeItem(key);
    }
  }

  // Clear sessionStorage (admin session token)
  sessionStorage.clear();

  // Wipe IndexedDB — delete the database entirely
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('loadout');
    req.onsuccess = () => resolve();
    req.onerror = () => {
      console.warn('Failed to delete IndexedDB, continuing anyway');
      resolve();
    };
    req.onblocked = () => {
      console.warn('IndexedDB delete blocked, may need to reload');
      resolve();
    };
    // Also try the old inspection-pwa database from earlier versions
    indexedDB.deleteDatabase('inspection-pwa');
  });
}

export function getDataVersion(): string {
  return DATA_VERSION;
}
