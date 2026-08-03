import { generateId } from '../shared';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { dbGetInspection, dbSavePhotoBlob, dbSaveInspection } from '../shared';
import { useCameraCapture } from '../shared';
import { checkImageQuality, type QualityIssue } from '../shared';
import { ImageQualityModal } from '../shared';
import { StepBackLink } from '../shared';
import type { Inspection, InspectionPhoto } from '../shared';
import { normalizeCloudPhotoUrl } from '../shared/services/resolvePhotoUrls';
import { useT } from '../shared/i18n/LanguageContext';

// Prefer the in-session object URL, then a legacy external URL if present.
function photoSrc(p: InspectionPhoto): string | undefined {
  if (p.localBlobUrl) return p.localBlobUrl;
  if (p.sharePointUrl) return normalizeCloudPhotoUrl(p.sharePointUrl, p.id);
  return undefined;
}

export function CaptureReturnsStagingRoute() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [pending, setPending] = useState<{
    blob: Blob;
    previewUrl: string;
    issues: QualityIssue[];
  } | null>(null);

  useEffect(() => {
    if (!id) return;
    dbGetInspection(id).then((i) => {
      if (!i) navigate('/');
      else setInspection(i);
    });
  }, [id, navigate]);

  const capture = useCameraCapture(async (blob) => {
    const quality = await checkImageQuality(blob);
    if (!quality.passed) {
      const previewUrl = URL.createObjectURL(blob);
      setPending({ blob, previewUrl, issues: quality.issues });
      return;
    }
    await processStagingPhoto(blob);
  });

  async function processStagingPhoto(blob: Blob) {
    if (!inspection) return;

    const bitmap = await createImageBitmap(blob);
    const photo: InspectionPhoto = {
      id: generateId(),
      capturedAt: new Date().toISOString(),
      capturedBy: inspection.startedBy || 'unknown',
      category: 'Staging_Final_Lane',
      localBlobUrl: URL.createObjectURL(blob),
      metadata: {
        deviceModel: navigator.userAgent.includes('iPad') ? 'iPad' : 'web',
        orientation: bitmap.width > bitmap.height ? 'landscape' : 'portrait',
        originalWidth: bitmap.width,
        originalHeight: bitmap.height,
        fileSizeBytes: blob.size,
      },
    };

    await dbSavePhotoBlob(photo.id, inspection.id, blob);

    setAnalyzing(true);
    try {
      const currentStaging = inspection.staging || {
        stagingLocation: '',
        stagedCorrectly: 'N/A',
        paperBagsProperlyStacked: 'N/A',
        ltlPalletsSecured: 'N/A',
        mixedPalletsLabeled: 'N/A',
        multiStopStickersAttached: 'N/A',
        palletQuantityMatchesBOL: 'N/A',
        overviewPhotos: [],
        coverSheetPhotos: [],
        finalLanePhotos: [],
      };

      const updatedStaging = { ...currentStaging };
      updatedStaging.finalLanePhotos = [...(updatedStaging.finalLanePhotos || []), photo];

      const updated: Inspection = {
        ...inspection,
        staging: updatedStaging,
        lastEditedAt: new Date().toISOString(),
      };
      await dbSaveInspection(updated);
      setInspection(updated);
    } finally {
      setAnalyzing(false);
    }
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
    await processStagingPhoto(blob);
  };

  const continueToVerify = async () => {
    if (!inspection) return;
    navigate(`/inspection/${inspection.id}/verify-returns`);
  };

  const removePhoto = async (photoId: string) => {
    if (!inspection) return;
    const updatedPhotos = (inspection.staging?.finalLanePhotos || []).filter(p => p.id !== photoId);
    const updated: Inspection = {
      ...inspection,
      staging: {
        ...inspection.staging,
        finalLanePhotos: updatedPhotos
      },
      lastEditedAt: new Date().toISOString()
    };
    await dbSaveInspection(updated);
    setInspection(updated);
  };

  if (!inspection) return null;

  const existingPhotos = inspection.staging?.finalLanePhotos || [];
  const latestPhoto = existingPhotos[existingPhotos.length - 1];

  return (
    <main style={{ maxWidth: 560 }}>
      <StepBackLink to={`/inspection/${inspection.id}/capture-returns-bol`} />

      <div className="page-head">
        <div>
          <h1 className="page-head__title">
            {t('returnsStaging.titleLead', 'Capture')}{' '}
            <em>{t('returnsStaging.titleEm', 'Returns Staging')}</em>
          </h1>
          <div className="page-head__sub">
            {t(
              'returnsStaging.subtitle',
              'Step 3 of 5 · Photograph the returns product in its final staging lane'
            )}
          </div>
        </div>
      </div>

      {latestPhoto ? (
        <div style={{ position: 'relative', marginBottom: 20 }}>
          <img
            src={photoSrc(latestPhoto)}
            alt={t('returnsStaging.latestPhotoAlt', 'Latest staging lane')}
            style={{
              width: '100%',
              aspectRatio: '4 / 3',
              objectFit: 'cover',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--rule-soft)',
            }}
          />
          <div
            className="xs"
            style={{
              position: 'absolute',
              bottom: 8,
              left: 8,
              background: 'rgba(28,25,23,0.7)',
              color: '#fff',
              padding: '4px 8px',
              borderRadius: '4px',
            }}
          >
            {t('returnsStaging.latestPhoto', 'Latest Photo')}
          </div>
        </div>
      ) : (
        <div
          style={{
            aspectRatio: '4 / 3',
            background: 'var(--surface-tint)',
            border: '2px dashed var(--rule-soft)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 20,
            padding: 24,
          }}
        >
          <div style={{ fontSize: 48, color: 'var(--ink-faint)', marginBottom: 8 }}>⌗</div>
          <div className="small soft">
            {analyzing
              ? t('returnsStaging.processing', 'Processing photo…')
              : t('returnsStaging.noPhotos', 'No photos taken yet')}
          </div>
        </div>
      )}

      {/* Grid of thumbnails if multiple photos exist */}
      {existingPhotos.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div className="xs soft" style={{ marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {t('returnsStaging.capturedPhotos', 'Captured Photos ({count})', {
              count: existingPhotos.length,
            })}
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
              gap: 8,
            }}
          >
            {existingPhotos.map((p, idx) => (
              <div key={p.id} style={{ position: 'relative' }}>
                <img
                  src={photoSrc(p)}
                  alt={t('returnsStaging.thumbAlt', 'Staging {n}', { n: idx + 1 })}
                  style={{
                    width: '100%',
                    aspectRatio: '1',
                    objectFit: 'cover',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--rule-soft)',
                  }}
                />
                <button
                  onClick={() => removePhoto(p.id)}
                  style={{
                    position: 'absolute',
                    top: 2,
                    right: 2,
                    background: 'rgba(178,36,28,0.9)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '50%',
                    width: 18,
                    height: 18,
                    fontSize: 10,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                  title={t('returnsStaging.deletePhoto', 'Delete photo')}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="banner banner--info" style={{ marginBottom: 20 }}>
        <span className="banner__icon">i</span>
        <div className="banner__body">
          {t(
            'returnsStaging.hint',
            'Please take photos of the staging lane containing the returned product. You can take as many pictures as needed.'
          )}
        </div>
      </div>

      <button
        className="btn btn--accent btn--lg"
        onClick={capture}
        disabled={analyzing}
        style={{ width: '100%' }}
      >
        📷{' '}
        {existingPhotos.length > 0
          ? t('returnsStaging.takeAnotherPhoto', 'Take another photo')
          : t('returnsStaging.takePhoto', 'Take photo')}
      </button>

      <div className="center mt-16">
        <button className="btn btn--ghost" onClick={continueToVerify}>
          {existingPhotos.length > 0
            ? t('returnsStaging.continue', 'Continue to verify →')
            : t('returnsStaging.skipNoPhotos', 'Skip — verify without photos')}
        </button>
      </div>

      {pending && (
        <ImageQualityModal
          previewUrl={pending.previewUrl}
          issues={pending.issues}
          onRetake={handleRetake}
          onKeep={handleKeep}
        />
      )}
    </main>
  );
}
