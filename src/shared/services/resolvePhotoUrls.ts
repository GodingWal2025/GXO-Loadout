/**
 * resolvePhotoUrls.ts
 *
 * After a page reload (or on a different device), the `localBlobUrl` stored on
 * InspectionPhoto objects is invalid — `URL.createObjectURL()` URLs are tied to
 * the page session that created them.
 *
 * This module provides helpers that:
 *   1. Re-create object URLs from the IndexedDB photoBlobs store (same device)
 *   2. Fall back to a legacy external `sharePointUrl`, when present
 *   3. Fall back to the shared server photo endpoint on another device
 */

import { dbGetPhotoBlob } from './db';
import type { InspectionPhoto } from '../types/inspection';

/**
 * Older records may contain an external photo URL. Keep it displayable without
 * rewriting it through a server-side storage proxy.
 */
export function normalizeCloudPhotoUrl(url: string, _photoId: string): string {
  return url;
}

/**
 * Resolve a single photo to a displayable URL.
 *
 * Priority:
 *   1. IndexedDB blob (device that captured it — works offline, always fresh)
 *   2. sharePointUrl  (legacy external source)
 *   3. localBlobUrl   (only valid in the same page session that captured it)
 *   4. shared server endpoint (other devices)
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

  // On other devices (or after session restart), fetch the uploaded photo from the server API endpoint.
  if (photo.id) {
    return `/api/photos/${encodeURIComponent(photo.id)}`;
  }

  // Fallback to localBlobUrl only if photo.id is missing
  return photo.localBlobUrl;
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
