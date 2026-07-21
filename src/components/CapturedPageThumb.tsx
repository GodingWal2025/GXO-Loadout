import { useEffect, useState } from 'react';
import { dbGetPhotoBlob } from '../shared';

/**
 * Thumbnail for a document page that is referenced only by photo id.
 *
 * Picklist/BOL records store `photoIds: string[]` rather than full
 * InspectionPhoto objects, so there is nothing to hand to usePhotoUrl. This
 * loads the blob straight from IndexedDB by id, which also means pages
 * captured in an earlier session still render.
 */
export function CapturedPageThumb({ photoId, label }: { photoId: string; label: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | undefined;
    let cancelled = false;

    dbGetPhotoBlob(photoId).then((blob) => {
      if (cancelled || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photoId]);

  return (
    <div className="photo-tile" title={label}>
      {url ? (
        <img src={url} alt={label} />
      ) : (
        <div
          className="xs soft"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}
        >
          …
        </div>
      )}
      <div className="photo-slot__label-overlay">{label}</div>
    </div>
  );
}
