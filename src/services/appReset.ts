// App reset mechanism.
//
// Manual device reset plus a data-version marker. IndexedDB schema upgrades
// migrate in place; an app release must never silently erase warehouse data.

const DATA_VERSION = '2';
const VERSION_KEY = 'loadout.data.version';

/**
 * Record the current data version without deleting existing data.
 * Call this at the very top of main.tsx, before any other localStorage/IDB access.
 */
export async function runResetIfNeeded(): Promise<void> {
  const stored = localStorage.getItem(VERSION_KEY);
  if (stored === DATA_VERSION) return;
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
