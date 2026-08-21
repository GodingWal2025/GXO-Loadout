/**
 * Ask supporting browsers not to evict IndexedDB under storage pressure.
 * Installed PWAs are the most likely to receive the grant. iPadOS versions
 * without this API still retain the same IndexedDB-backed offline queue.
 */
export async function requestPersistentAppStorage(): Promise<boolean | undefined> {
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  if (!storage?.persisted || !storage.persist) return undefined;

  try {
    if (await storage.persisted()) return true;
    return await storage.persist();
  } catch {
    // Storage persistence is an optimization; IndexedDB remains functional.
    return undefined;
  }
}
