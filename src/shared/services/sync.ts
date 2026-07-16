import {
  dbGetPendingSync,
  dbRequeueStalledSync,
  dbUpdateSyncEntry,
  dbGetInspection,
  dbGetPhotoBlob,
  dbMarkPhotoUploaded,
  dbSaveInspection,
  upsertDownloadedInspection,
  getDB,
} from './db';
import type { InspectionPhoto } from '../types/inspection';

let isSyncing = false;
let isPulling = false;
let apiUrl = '';

const PUSH_INTERVAL_MS = 10_000;
const PULL_INTERVAL_MS = 30_000;

export function setApiUrl(url: string): void {
  apiUrl = url;
}

// NOTE: we deliberately do NOT gate sync on navigator.onLine or a HEAD "is the
// server reachable" probe. Both are unreliable in iOS/iPadOS standalone PWAs
// (navigator.onLine can be stuck false; the probe can time out on a cold
// launch), and when they misfired the app never synced. Instead we just attempt
// the real request — if it fails, the retry queue picks it up next cycle.
export async function processSyncQueue(): Promise<void> {
  if (isSyncing) return;
  isSyncing = true;

  try {
    // Bring previously-failed and orphaned in-progress entries back into the
    // queue. Without this, anything enqueued while the API was unreachable
    // (e.g. before the backend was deployed) would never be retried.
    const requeued = await dbRequeueStalledSync();

    const pendingEntries = await dbGetPendingSync();

    // Only announce a sync cycle when there's actually work to do, so an idle
    // app doesn't log every 10s.
    if (pendingEntries.length > 0) {
      console.log(
        `[loadout-sync] Syncing ${pendingEntries.length} item(s)` +
        (requeued > 0 ? ` (${requeued} re-queued)` : '') + '...'
      );
    }

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

            // 3. Write a permanent URL back onto the InspectionPhoto record so
            //    other devices (and the Investigation page) can display it.
            //    We use the /api/photo proxy URL, NOT the raw blob URL: the
            //    "photos" container is private, so blob.core.windows.net URLs
            //    return 403/404 on any device without a SAS token.
            const permanentUrl = `${apiUrl}/api/photo?photoId=${entry.photoId}`;
            await writeBlobUrlToInspectionPhoto(entry.inspectionId, entry.photoId, permanentUrl);

            entry.status = 'done';
            await dbUpdateSyncEntry(entry);
          } else {
            throw new Error(`Server returned ${response.status}`);
          }
        }
      } catch (err) {
        // A rejected fetch (connectivity failure) throws a TypeError; a server
        // that responded with a bad status throws a plain Error above. Only
        // count server-side rejections toward the retry cap — an offline field
        // device must keep retrying indefinitely, not strand its data after a
        // few failed cycles.
        const isNetworkError = err instanceof TypeError;
        console.error(`[loadout-sync] Failed to process sync entry ${entry.id}${isNetworkError ? ' (offline?)' : ''}:`, err);
        entry.status = 'failed';
        if (!isNetworkError) entry.attempts += 1;
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

export async function pullInspectionsFromServer(): Promise<void> {
  if (isPulling) return;
  isPulling = true;

  try {
    // cache: 'no-store' matters on iOS/iPadOS Safari, which otherwise happily
    // serves a stale cached GET so the device never sees newly-synced data.
    const response = await fetch(`${apiUrl}/api/inspections`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Failed to fetch inspections: ${response.status}`);

    const { resources } = await response.json();
    if (Array.isArray(resources)) {
      for (const inspection of resources) {
        await upsertDownloadedInspection(inspection);
      }
      // Only log and nudge the UI when the server actually returned data, so an
      // empty server doesn't spam the console or trigger needless re-renders.
      if (resources.length > 0) {
        console.log(`[loadout-sync] Pulled ${resources.length} inspection(s) from server.`);
        window.dispatchEvent(new CustomEvent('loadout-sync-updated'));
      }
    }
  } catch (error) {
    console.error('[loadout-sync] Error pulling inspections:', error);
  } finally {
    isPulling = false;
  }
}

export function startBackgroundSync(): void {
  const fullSync = () => {
    pullInspectionsFromServer();
    processSyncQueue();
  };

  // Initial sync on load.
  fullSync();

  // Push often; pull on a slower cadence so the device still recovers even if
  // the one-shot startup pull was missed (e.g. launched before the network was
  // ready) — the previous one-shot-only pull is exactly why iPads started fresh.
  setInterval(processSyncQueue, PUSH_INTERVAL_MS);
  setInterval(pullInspectionsFromServer, PULL_INTERVAL_MS);

  // Re-sync when connectivity returns or the app is brought back to the
  // foreground. The visibility handler is essential on iOS/iPadOS, where
  // background timers are suspended and the 'online' event often never fires.
  window.addEventListener('online', fullSync);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') fullSync();
  });
}

/**
 * After a photo blob is uploaded to Azure Blob Storage, write the permanent
 * blob URL onto the matching InspectionPhoto record so it can be displayed on
 * any device (not just the one that captured it).
 */
async function writeBlobUrlToInspectionPhoto(
  inspectionId: string,
  photoId: string,
  blobUrl: string
): Promise<void> {
  const inspection = await dbGetInspection(inspectionId);
  if (!inspection) return;

  let found = false;

  const patchPhoto = (photo: InspectionPhoto): InspectionPhoto => {
    if (photo.id === photoId) {
      found = true;
      return { ...photo, sharePointUrl: blobUrl };
    }
    return photo;
  };

  // Search pallet photos
  inspection.pallets = inspection.pallets.map((p) => ({
    ...p,
    photos: p.photos.map(patchPhoto),
  }));

  // Search staging photos
  inspection.staging.overviewPhotos = inspection.staging.overviewPhotos.map(patchPhoto);
  inspection.staging.coverSheetPhotos = inspection.staging.coverSheetPhotos.map(patchPhoto);
  if (inspection.staging.finalLanePhotos) {
    inspection.staging.finalLanePhotos = inspection.staging.finalLanePhotos.map(patchPhoto);
  }

  if (found) {
    // Bump lastEditedAt — without this, other devices' pull-side conflict check
    // (existing.lastEditedAt >= incoming.lastEditedAt) rejects the update and
    // the photo URL never reaches them. This was why photos only showed on the
    // device that captured them.
    inspection.lastEditedAt = new Date().toISOString();
    // Save back to IndexedDB — this also enqueues a sync so the inspection
    // record (now with the photo URL) gets pushed to Cosmos DB.
    await dbSaveInspection(inspection);
    console.log(`[loadout-sync] Wrote blob URL for photo ${photoId} on inspection ${inspectionId}`);
  }
}
