// Tracks only in-flight/failed local persistence. Cloud upload state is owned by
// the sync queue and must not be mixed with this device-safety signal.
type SaveState = { pending: number; failed: number };
const writes = new Map<string, { token: symbol; retry: () => Promise<void>; failed: boolean }>();

export function getLocalSaveState(): SaveState {
  return { pending: [...writes.values()].filter(write => !write.failed).length, failed: [...writes.values()].filter(write => write.failed).length };
}

function publish() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('loadout-local-save', { detail: getLocalSaveState() }));
}

/** A local write is safe only after its IndexedDB transaction commits. */
export async function trackLocalSave(key: string, save: () => Promise<void>): Promise<void> {
  const token = Symbol(key);
  writes.set(key, { token, retry: () => trackLocalSave(key, save), failed: false });
  publish();
  try {
    await save();
    // A second save for the same record can start before the first finishes.
    // Tokens prevent the older completion from clearing the newer write.
    if (writes.get(key)?.token === token) writes.delete(key);
  } catch (error) {
    const current = writes.get(key);
    if (current?.token === token) current.failed = true;
    throw error;
  } finally {
    publish();
  }
}

export async function retryLocalSaves(): Promise<void> {
  await Promise.allSettled([...writes.values()].filter(write => write.failed).map(write => write.retry()));
}
