import { generateId } from '../utils/uuid';
import { useState } from 'react';
import type {
  InspectionPhoto,
  PhotoCategory,
  PhotoMetadata,
  QualityFlag,
} from '../types/inspection';
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
  currentUser: string;
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
  currentUser,
}: SlotPhotoCaptureProps) {
  const [pending, setPending] = useState<PendingCapture | null>(null);
  const [viewing, setViewing] = useState(false);
  const displayUrl = usePhotoUrl(existingPhoto);

  const capture = useCameraCapture(async (blob) => {
    const quality = await checkImageQuality(blob);
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
        >
          <div className="photo-slot__icon">📷</div>
          <div className="photo-slot__label">{slotLabel}</div>
          <div className="photo-slot__hint">Tap to capture</div>
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
      <div className={tileClass} onClick={() => setViewing(true)}>
        <img src={displayUrl} alt={slotLabel} />

        <QualityFlagButton
          flag={existingPhoto.qualityFlag}
          level="photo"
          onFlag={(f) => onQualityFlag(existingPhoto.id, f)}
          onUnflag={() => onQualityFlag(existingPhoto.id, undefined)}
          currentUser={currentUser}
        />

        <div className="photo-slot__label-overlay">{slotLabel}</div>
      </div>
      {viewing && (
        <PhotoLightbox
          url={displayUrl}
          label={slotLabel}
          onClose={() => setViewing(false)}
          onRetake={capture}
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
  label: string;
  currentUser: string;
}

export function MultiPhotoCapture({
  inspectionId,
  category,
  existingPhotos,
  onPhotoAdded,
  onPhotoQualityFlag,
  label,
  currentUser,
}: MultiCaptureProps) {
  const [pending, setPending] = useState<PendingCapture | null>(null);
  const [viewingPhoto, setViewingPhoto] = useState<InspectionPhoto | null>(null);
  const viewingUrl = usePhotoUrl(viewingPhoto || undefined);

  const capture = useCameraCapture(async (blob) => {
    const quality = await checkImageQuality(blob);
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
          <button className="btn btn--sm btn--accent" onClick={capture}>
            + Photo
          </button>
        </div>
        {existingPhotos.length > 0 && (
          <div className="photo-grid">
            {existingPhotos.map((p) => (
              <MultiPhotoTile
                key={p.id}
                photo={p}
                onView={() => setViewingPhoto(p)}
                onQualityFlag={onPhotoQualityFlag}
                currentUser={currentUser}
              />
            ))}
          </div>
        )}
      </div>
      {viewingPhoto && (
        <PhotoLightbox
          url={viewingUrl}
          label={viewingPhoto.category.replace(/_/g, ' ')}
          onClose={() => setViewingPhoto(null)}
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
  currentUser,
}: {
  photo: InspectionPhoto;
  onView: () => void;
  onQualityFlag: (photoId: string, flag?: QualityFlag) => void;
  currentUser: string;
}) {
  const url = usePhotoUrl(photo);
  return (
    <div
      className={[
        'photo-tile',
        photo.qualityFlag ? 'photo-tile--quality-flagged' : '',
      ].filter(Boolean).join(' ')}
      onClick={onView}
      style={{ cursor: 'pointer' }}
    >
      <img src={url} alt={photo.category} />
      <QualityFlagButton
        flag={photo.qualityFlag}
        level="photo"
        onFlag={(f) => onQualityFlag(photo.id, f)}
        onUnflag={() => onQualityFlag(photo.id, undefined)}
        currentUser={currentUser}
      />
    </div>
  );
}
