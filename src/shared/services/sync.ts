import {
  dbGetPendingSync,
  dbUpdateSyncEntry,
  dbGetInspection,
  dbGetPhotoBlob,
  dbMarkPhotoUploaded,
  getDB,
} from './db';

let isSyncing = false;
let apiUrl = '';

export function setApiUrl(url: string): void {
  apiUrl = url;
}

// Ping helper to verify the server is actually reachable
async function isServerReachable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    // Ping the root of the site (or API) to ensure connectivity beyond navigator.onLine
    const res = await fetch(`/`, { method: 'HEAD', signal: controller.signal });
    clearTimeout(timeoutId);
    return res.ok;
  } catch {
    return false;
  }
}

export async function processSyncQueue(): Promise<void> {
  if (isSyncing) return;
  if (!navigator.onLine) return;
  
  // Verify server is actually reachable
  const reachable = await isServerReachable();
  if (!reachable) {
    console.log('[loadout-sync] Server is unreachable. Postponing sync.');
    return;
  }

  isSyncing = true;
  console.log('[loadout-sync] Starting background sync process...');

  try {
    const pendingEntries = await dbGetPendingSync();
    
    for (const entry of pendingEntries) {
      if (entry.status === 'done') continue;
      
      entry.status = 'in-progress';
      await dbUpdateSyncEntry(entry);
      
      try {
        if (entry.type === 'inspection-save' || entry.type === 'inspection-complete') {
          const inspection = await dbGetInspection(entry.inspectionId);
          if (!inspection) {
            entry.status = 'done';
            await dbUpdateSyncEntry(entry);
            continue;
          }
          
          const response = await fetch(`${apiUrl}/api/sync-inspection`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(inspection),
          });
          
          if (response.ok) {
            entry.status = 'done';
            await dbUpdateSyncEntry(entry);
          } else if (response.status === 409) {
            console.warn(`[loadout-sync] Conflict for inspection ${entry.inspectionId}: server has newer data. Skipping.`);
            entry.status = 'done';
            await dbUpdateSyncEntry(entry);
          } else {
            throw new Error(`Server returned ${response.status}`);
          }
        }
        else if (entry.type === 'photo-upload') {
          if (!entry.photoId) {
            entry.status = 'done';
            await dbUpdateSyncEntry(entry);
            continue;
          }
          const blob = await dbGetPhotoBlob(entry.photoId);
          if (!blob) {
            entry.status = 'done';
            await dbUpdateSyncEntry(entry);
            continue;
          }
          
          // 1. Get SAS token from Azure Function
          const tokenRes = await fetch(`${apiUrl}/api/photo-upload-token?photoId=${entry.photoId}`);
          if (!tokenRes.ok) throw new Error(`Failed to get SAS token: ${tokenRes.status}`);
          const { sasUrl } = await tokenRes.json();
          
          // 2. Upload directly to Azure Blob Storage using the SAS URL
          const response = await fetch(sasUrl, {
            method: 'PUT',
            headers: {
              'x-ms-blob-type': 'BlockBlob',
              'Content-Type': 'image/jpeg',
            },
            body: blob,
          });
          
          if (response.ok) {
            await dbMarkPhotoUploaded(entry.photoId);
            entry.status = 'done';
            await dbUpdateSyncEntry(entry);
          } else {
            throw new Error(`Server returned ${response.status}`);
          }
        }
      } catch (err) {
        console.error(`[loadout-sync] Failed to process sync entry ${entry.id}:`, err);
        entry.status = 'failed';
        entry.attempts += 1;
        entry.lastAttemptAt = new Date().toISOString();
        entry.lastError = err instanceof Error ? err.message : String(err);
        await dbUpdateSyncEntry(entry);
      }
    }
    
    // Clean up completed entries
    const db = await getDB();
    const tx = db.transaction('syncQueue', 'readwrite');
    const allEntries = await tx.store.getAll();
    for (const record of allEntries) {
      if (record.status === 'done' && record.id !== undefined) {
        await tx.store.delete(record.id);
      }
    }
    await tx.done;
    
  } catch (err) {
    console.error('[loadout-sync] Error running sync queue:', err);
  } finally {
    isSyncing = false;
  }
}

export function startBackgroundSync(): void {
  processSyncQueue();
  setInterval(processSyncQueue, 10000);
  
  window.addEventListener('online', () => {
    console.log('[loadout-sync] Browser went online. Triggering sync...');
    processSyncQueue();
  });
}
