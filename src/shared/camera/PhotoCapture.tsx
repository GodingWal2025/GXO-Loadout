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
      <div className={tileClass} onClick={capture}>
        <img
          src={existingPhoto.localBlobUrl || existingPhoto.sharePointUrl}
          alt={slotLabel}
        />

        <QualityFlagButton
          flag={existingPhoto.qualityFlag}
          level="photo"
          onFlag={(f) => onQualityFlag(existingPhoto.id, f)}
          onUnflag={() => onQualityFlag(existingPhoto.id, undefined)}
          currentUser={currentUser}
        />

        <div className="photo-slot__label-overlay">{slotLabel}</div>
      </div>
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
              <div
                key={p.id}
                className={[
                  'photo-tile',
                  p.qualityFlag ? 'photo-tile--quality-flagged' : '',
                ].filter(Boolean).join(' ')}
              >
                <img src={p.localBlobUrl || p.sharePointUrl} alt={p.category} />
                <QualityFlagButton
                  flag={p.qualityFlag}
                  level="photo"
                  onFlag={(f) => onPhotoQualityFlag(p.id, f)}
                  onUnflag={() => onPhotoQualityFlag(p.id, undefined)}
                  currentUser={currentUser}
                />
              </div>
            ))}
          </div>
        )}
      </div>
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
