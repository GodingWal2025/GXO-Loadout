/**
 * resolvePhotoUrls.ts
 *
 * After a page reload (or on a different device), the `localBlobUrl` stored on
 * InspectionPhoto objects is invalid — `URL.createObjectURL()` URLs are tied to
 * the page session that created them.
 *
 * This module provides helpers that:
 *   1. Re-create object URLs from the IndexedDB photoBlobs store (same device)
 *   2. Fall back to `sharePointUrl` (the Azure Blob Storage URL set after upload)
 *   3. Return a display-ready URL string, or undefined if no source is available
 */

import { dbGetPhotoBlob } from './db';
import type { InspectionPhoto } from '../types/inspection';

/**
 * Photos uploaded before the /api/photo proxy existed have a raw
 * `https://<account>.blob.core.windows.net/photos/<photoId>` URL stored. The
 * photos container is PRIVATE, so those URLs 403/404 on other devices. Since
 * the blob name is always the photo id, rewrite them to the proxy endpoint.
 */
export function normalizeCloudPhotoUrl(url: string, photoId: string): string {
  if (/^https:\/\/[^/]+\.blob\.core\.windows\.net\//i.test(url)) {
    return `/api/photo?photoId=${photoId}`;
  }
  return url;
}

/**
 * Resolve a single photo to a displayable URL.
 *
 * Priority:
 *   1. IndexedDB blob (device that captured it — works offline, always fresh)
 *   2. sharePointUrl  (cloud — works on any device, normalized to /api/photo)
 *   3. localBlobUrl   (only valid in the same page session that captured it)
 */
export async function resolvePhotoUrl(photo: InspectionPhoto): Promise<string | undefined> {
  // Same-device: pull the blob from IndexedDB. This works offline and avoids a
  // network round-trip for the device that captured the photo.
  try {
    const blob = await dbGetPhotoBlob(photo.id);
    if (blob) {
      return URL.createObjectURL(blob);
    }
  } catch {
    // IndexedDB might not have this photo (different device)
  }

  // Cloud URL — works on any device once the photo has been uploaded
  if (photo.sharePointUrl) return normalizeCloudPhotoUrl(photo.sharePointUrl, photo.id);

  // Last resort: the object URL from this page session (fresh capture)
  if (photo.localBlobUrl) return photo.localBlobUrl;

  return undefined;
}

/**
 * Resolve display URLs for all photos in an array.
 * Returns a Map of photoId → displayUrl.
 */
export async function resolvePhotoUrls(
  photos: InspectionPhoto[]
): Promise<Map<string, string>> {
  const urlMap = new Map<string, string>();

  await Promise.all(
    photos.map(async (photo) => {
      const url = await resolvePhotoUrl(photo);
      if (url) {
        urlMap.set(photo.id, url);
      }
    })
  );

  return urlMap;
}
