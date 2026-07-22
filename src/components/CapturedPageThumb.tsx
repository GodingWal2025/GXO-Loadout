import { useCallback, useEffect, useState } from 'react';
import { dbGetPhotoBlob, dbSavePhotoBlob } from '../shared';
import { useT } from '../shared/i18n/LanguageContext';

/**
 * Thumbnail for a document page that is referenced only by photo id.
 *
 * Picklist/BOL records store `photoIds: string[]` rather than full
 * InspectionPhoto objects, so there is nothing to hand to usePhotoUrl. This
 * loads the blob straight from IndexedDB by id, which also means pages
 * captured in an earlier session still render.
 */
export function CapturedPageThumb({
  photoId,
  label,
  inspectionId,
}: {
  photoId: string;
  label: string;
  /** Enables the rotate control. Omit for read-only contexts. */
  inspectionId?: string;
}) {
  const t = useT();
  const [url, setUrl] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  // Bumped after a rotate so the effect re-reads the stored blob.
  const [version, setVersion] = useState(0);

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
  }, [photoId, version]);

  /**
   * Rotate the stored page 90° clockwise and write it back.
   *
   * Cameras and EXIF handling disagree often enough that a page can still land
   * sideways however carefully the capture path normalises it. This is the
   * inspector's escape hatch: it re-encodes the pixels themselves, so the
   * result is correct no matter what the original file claimed.
   */
  const rotate = useCallback(async () => {
    if (!inspectionId || rotating) return;
    setRotating(true);
    try {
      const blob = await dbGetPhotoBlob(photoId);
      if (!blob) return;

      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      // Swap width and height for the quarter turn.
      canvas.width = bitmap.height;
      canvas.height = bitmap.width;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.translate(canvas.width, 0);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close?.();

      const rotated = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85)
      );
      if (!rotated) return;

      // Same photo id, so the picklist/BOL photoIds list is untouched. Saving
      // resets `uploaded`, which re-queues the corrected image for sync.
      await dbSavePhotoBlob(photoId, inspectionId, rotated);
      setVersion((v) => v + 1);
    } finally {
      setRotating(false);
    }
  }, [photoId, inspectionId, rotating]);

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
      {inspectionId && url && (
        <button
          type="button"
          className="photo-tile__rotate"
          onClick={rotate}
          disabled={rotating}
          aria-label={t('pageThumb.rotate', 'Rotate this page 90°')}
          title={t('pageThumb.rotate', 'Rotate this page 90°')}
        >
          ↻
        </button>
      )}
      <div className="photo-slot__label-overlay">{label}</div>
    </div>
  );
}
