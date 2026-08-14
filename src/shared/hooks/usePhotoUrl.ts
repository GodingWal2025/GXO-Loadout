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
    let createdUrl: string | undefined;

    if (!photo) {
      setUrl(undefined);
      return;
    }

    resolvePhotoUrl(photo).then((resolved) => {
      if (cancelled) {
        if (resolved && resolved.startsWith('blob:')) {
          try {
            URL.revokeObjectURL(resolved);
          } catch {
            // ignore
          }
        }
        return;
      }
      createdUrl = resolved;
      setUrl(resolved);
    });

    return () => {
      cancelled = true;
      if (createdUrl && createdUrl.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(createdUrl);
        } catch {
          // ignore
        }
      }
    };
  }, [photo?.id, photo?.sharePointUrl, photo?.localBlobUrl]);

  return url;
}
