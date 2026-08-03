import { useEffect, useState } from 'react';
import type { InspectionPhoto } from '../types/inspection';
import { resolvePhotoUrl } from '../services/resolvePhotoUrls';

/**
 * Resolve a display URL for a photo, handling all three sources:
 * IndexedDB blob, a legacy external URL, or the in-session object URL.
 */
export function usePhotoUrl(photo: InspectionPhoto | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    if (!photo) {
      setUrl(undefined);
      return;
    }
    resolvePhotoUrl(photo).then((resolved) => {
      if (!cancelled) setUrl(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [photo?.id, photo?.sharePointUrl, photo?.localBlobUrl]);

  return url;
}
