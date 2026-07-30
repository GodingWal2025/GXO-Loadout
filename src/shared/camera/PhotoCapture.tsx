import { generateId } from '../utils/uuid';
import { useState } from 'react';
import type {
  InspectionPhoto,
  PhotoCategory,
  PhotoMetadata,
  QualityFlag,
} from '../types/inspection';
import { getPhotoRotation } from '../types/inspection';
import { useCameraCapture } from './useCameraCapture';
import { dbSavePhotoBlob } from '../services/db';
import { compressPhoto } from './compressPhoto';
import { checkImageQuality, type QualityIssue } from './imageQuality';
import { QualityFlagButton } from '../components/QualityFlagButton';
import { ImageQualityModal } from '../components/ImageQualityModal';
import { PhotoLightbox } from '../components/PhotoLightbox';
import { usePhotoUrl } from '../hooks/usePhotoUrl';

// ---- Pending capture (image quality review) ----

interface PendingCapture {
  blob: Blob;
  previewUrl: string;
  issues: QualityIssue[];
  metrics: { blurScore: number; meanBrightness: number; stdDevBrightness: number };
}

// =============================================================
// SlotPhotoCapture - single fixed slot for pallet sides, bag flaps, etc.
// =============================================================

interface SlotPhotoCaptureProps {
  inspectionId: string;
  category: PhotoCategory;
  slotKey: string;
  slotLabel: string;
  palletIndex?: number;
  existingPhoto?: InspectionPhoto;
  onCaptured: (photo: InspectionPhoto) => void;
  onQualityFlag: (photoId: string, flag?: QualityFlag) => void;
  onRotatePhoto?: (photoId: string) => void;
  currentUser: string;
  /** View mode on a completed inspection — photos can be opened but not changed. */
  readOnly?: boolean;
  /** Skip the portrait-orientation warning (for wide/document subjects). */
  allowLandscape?: boolean;
}

export function SlotPhotoCapture({
  inspectionId,
  category,
  slotKey,
  slotLabel,
  palletIndex,
  existingPhoto,
  onCaptured,
  onQualityFlag,
  onRotatePhoto,
  currentUser,
  readOnly = false,
  allowLandscape = false,
}: SlotPhotoCaptureProps) {
  const [pending, setPending] = useState<PendingCapture | null>(null);
  const [viewing, setViewing] = useState(false);
  const displayUrl = usePhotoUrl(existingPhoto);
  const [localRotation, setLocalRotation] = useState<number | null>(null);

  const initialRotation = getPhotoRotation(existingPhoto);
  const effectiveRotation = localRotation !== null ? localRotation : initialRotation;

  const handleRotate = () => {
    const nextRot = (effectiveRotation + 90) % 360;
    setLocalRotation(nextRot);
    if (onRotatePhoto && existingPhoto) {
      onRotatePhoto(existingPhoto.id);
    }
  };

  const capture = useCameraCapture(async (blob) => {
    const quality = await checkImageQuality(blob, { allowLandscape });
    if (!quality.passed) {
      const previewUrl = URL.createObjectURL(blob);
      setPending({
        blob,
        previewUrl,
        issues: quality.issues,
        metrics: quality.metrics,
      });
      return;
    }
    await processCapture(blob);
  });

  async function processCapture(blob: Blob) {
    const compressed = await compressPhoto(blob);
    const bitmap = await createImageBitmap(compressed);
    const metadata: PhotoMetadata = {
      deviceModel: navigator.userAgent.includes('iPad') ? 'iPad' : 'web',
      orientation: bitmap.width > bitmap.height ? 'landscape' : 'portrait',
      originalWidth: bitmap.width,
      originalHeight: bitmap.height,
      fileSizeBytes: compressed.size,
    };

    const photo: InspectionPhoto = {
      id: generateId(),
      capturedAt: new Date().toISOString(),
      capturedBy: currentUser || 'unknown',
      category,
      palletIndex,
      slotKey,
      localBlobUrl: URL.createObjectURL(compressed),
      metadata,
    };

    await dbSavePhotoBlob(photo.id, inspectionId, compressed);
    onCaptured(photo);
  }

  const handleRetake = () => {
    if (pending) URL.revokeObjectURL(pending.previewUrl);
    setPending(null);
    setTimeout(() => capture(), 50);
  };

  const handleKeep = async () => {
    if (!pending) return;
    const { blob, previewUrl } = pending;
    URL.revokeObjectURL(previewUrl);
    setPending(null);
    await processCapture(blob);
  };

  if (!existingPhoto) {
    return (
      <>
        <button
          className="photo-slot photo-slot--empty"
          onClick={capture}
          type="button"
          disabled={readOnly}
        >
          <div className="photo-slot__icon">📷</div>
          <div className="photo-slot__label">{slotLabel}</div>
          <div className="photo-slot__hint">{readOnly ? 'Not captured' : 'Tap to capture'}</div>
        </button>
        {pending && (
          <ImageQualityModal
            previewUrl={pending.previewUrl}
            issues={pending.issues}
            onRetake={handleRetake}
            onKeep={handleKeep}
          />
        )}
      </>
    );
  }

  const tileClass = [
    'photo-slot',
    'photo-slot--filled',
    existingPhoto.qualityFlag ? 'photo-slot--quality-flagged' : '',
  ].filter(Boolean).join(' ');

  return (
    <>
      {/* Tapping a filled slot ENLARGES the photo; retake is a button inside the viewer */}
      <div className={tileClass} onClick={() => setViewing(true)} style={{ overflow: 'hidden' }}>
        <img
          src={displayUrl}
          alt={slotLabel}
          style={{
            transform: `rotate(${effectiveRotation}deg)`,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transition: 'transform 0.2s ease',
          }}
        />

        {!readOnly && (
          <QualityFlagButton
            flag={existingPhoto.qualityFlag}
            level="photo"
            onFlag={(f) => onQualityFlag(existingPhoto.id, f)}
            onUnflag={() => onQualityFlag(existingPhoto.id, undefined)}
            currentUser={currentUser}
          />
        )}

        {onRotatePhoto && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleRotate();
            }}
            title="Rotate photo"
            style={{
              position: 'absolute',
              bottom: 4,
              right: 4,
              background: 'rgba(0,0,0,0.6)',
              color: '#fff',
              border: 'none',
              borderRadius: '50%',
              width: 24,
              height: 24,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              cursor: 'pointer',
              zIndex: 2,
            }}
          >
            ↻
          </button>
        )}

        <div className="photo-slot__label-overlay">{slotLabel}</div>
      </div>
      {viewing && (
        <PhotoLightbox
          url={displayUrl}
          label={slotLabel}
          rotation={effectiveRotation}
          onClose={() => setViewing(false)}
          onRetake={readOnly ? undefined : capture}
          onRotate={handleRotate}
        />
      )}
      {pending && (
        <ImageQualityModal
          previewUrl={pending.previewUrl}
          issues={pending.issues}
          onRetake={handleRetake}
          onKeep={handleKeep}
        />
      )}
    </>
  );
}

// =============================================================
// MultiPhotoCapture - for ad-hoc photo lists like staging-area overview
// =============================================================

interface MultiCaptureProps {
  inspectionId: string;
  category: PhotoCategory;
  existingPhotos: InspectionPhoto[];
  onPhotoAdded: (photo: InspectionPhoto) => void;
  onPhotoQualityFlag: (photoId: string, flag?: QualityFlag) => void;
  onRotatePhoto?: (photoId: string) => void;
  label: string;
  currentUser: string;
  /** View mode on a completed inspection — photos can be opened but not added. */
  readOnly?: boolean;
  /** Skip the portrait-orientation warning (for wide/document subjects). */
  allowLandscape?: boolean;
}

export function MultiPhotoCapture({
  inspectionId,
  category,
  existingPhotos,
  onPhotoAdded,
  onPhotoQualityFlag,
  onRotatePhoto,
  label,
  currentUser,
  readOnly = false,
  allowLandscape = false,
}: MultiCaptureProps) {
  const [pending, setPending] = useState<PendingCapture | null>(null);
  const [viewingPhoto, setViewingPhoto] = useState<InspectionPhoto | null>(null);
  const viewingUrl = usePhotoUrl(viewingPhoto || undefined);

  const capture = useCameraCapture(async (blob) => {
    const quality = await checkImageQuality(blob, { allowLandscape });
    if (!quality.passed) {
      const previewUrl = URL.createObjectURL(blob);
      setPending({
        blob,
        previewUrl,
        issues: quality.issues,
        metrics: quality.metrics,
      });
      return;
    }
    await processCapture(blob);
  });

  async function processCapture(blob: Blob) {
    const compressed = await compressPhoto(blob);
    const bitmap = await createImageBitmap(compressed);
    const metadata: PhotoMetadata = {
      deviceModel: navigator.userAgent.includes('iPad') ? 'iPad' : 'web',
      orientation: bitmap.width > bitmap.height ? 'landscape' : 'portrait',
      originalWidth: bitmap.width,
      originalHeight: bitmap.height,
      fileSizeBytes: compressed.size,
    };

    const photo: InspectionPhoto = {
      id: generateId(),
      capturedAt: new Date().toISOString(),
      capturedBy: currentUser || 'unknown',
      category,
      localBlobUrl: URL.createObjectURL(compressed),
      metadata,
    };

    await dbSavePhotoBlob(photo.id, inspectionId, compressed);
    onPhotoAdded(photo);
  }

  const handleRetake = () => {
    if (pending) URL.revokeObjectURL(pending.previewUrl);
    setPending(null);
    setTimeout(() => capture(), 50);
  };

  const handleKeep = async () => {
    if (!pending) return;
    const { blob, previewUrl } = pending;
    URL.revokeObjectURL(previewUrl);
    setPending(null);
    await processCapture(blob);
  };

  return (
    <>
      <div className="field">
        <div className="row-between mb-8">
          <div className="field__label" style={{ margin: 0 }}>{label}</div>
          {!readOnly && (
            <button className="btn btn--sm btn--accent" onClick={capture}>
              + Photo
            </button>
          )}
        </div>
        {existingPhotos.length > 0 ? (
          <div className="photo-grid">
            {existingPhotos.map((p) => (
              <MultiPhotoTile
                key={p.id}
                photo={p}
                onView={() => setViewingPhoto(p)}
                onQualityFlag={onPhotoQualityFlag}
                onRotatePhoto={onRotatePhoto}
                currentUser={currentUser}
                readOnly={readOnly}
              />
            ))}
          </div>
        ) : readOnly ? (
          <div className="empty" style={{ padding: 16 }}>
            <div className="empty__sub">No photos captured.</div>
          </div>
        ) : null}
      </div>
      {viewingPhoto && (
        <PhotoLightbox
          url={viewingUrl}
          label={viewingPhoto.category.replace(/_/g, ' ')}
          rotation={getPhotoRotation(viewingPhoto)}
          onClose={() => setViewingPhoto(null)}
          onRotate={onRotatePhoto ? () => onRotatePhoto(viewingPhoto.id) : undefined}
        />
      )}
      {pending && (
        <ImageQualityModal
          previewUrl={pending.previewUrl}
          issues={pending.issues}
          onRetake={handleRetake}
          onKeep={handleKeep}
        />
      )}
    </>
  );
}

function MultiPhotoTile({
  photo,
  onView,
  onQualityFlag,
  onRotatePhoto,
  currentUser,
  readOnly = false,
}: {
  photo: InspectionPhoto;
  onView: () => void;
  onQualityFlag: (photoId: string, flag?: QualityFlag) => void;
  onRotatePhoto?: (photoId: string) => void;
  currentUser: string;
  readOnly?: boolean;
}) {
  const url = usePhotoUrl(photo);
  const rot = getPhotoRotation(photo);
  return (
    <div
      className={[
        'photo-tile',
        photo.qualityFlag ? 'photo-tile--quality-flagged' : '',
      ].filter(Boolean).join(' ')}
      onClick={onView}
      style={{ cursor: 'pointer', overflow: 'hidden' }}
    >
      <img
        src={url}
        alt={photo.category}
        style={{
          transform: `rotate(${rot}deg)`,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transition: 'transform 0.2s ease',
        }}
      />
      {!readOnly && (
        <QualityFlagButton
          flag={photo.qualityFlag}
          level="photo"
          onFlag={(f) => onQualityFlag(photo.id, f)}
          onUnflag={() => onQualityFlag(photo.id, undefined)}
          currentUser={currentUser}
        />
      )}
      {onRotatePhoto && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRotatePhoto(photo.id);
          }}
          title="Rotate photo"
          style={{
            position: 'absolute',
            bottom: 4,
            right: 4,
            background: 'rgba(0,0,0,0.6)',
            color: '#fff',
            border: 'none',
            borderRadius: '50%',
            width: 24,
            height: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            cursor: 'pointer',
            zIndex: 2,
          }}
        >
          ↻
        </button>
      )}
    </div>
  );
}
