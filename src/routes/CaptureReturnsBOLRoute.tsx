import { generateId } from '../shared';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { dbGetInspection, dbSavePhotoBlob, dbSaveInspection } from '../shared';
import { useCameraCapture } from '../shared';

import { checkImageQuality, type QualityIssue } from '../shared';
import { ImageQualityModal } from '../shared';
import { StepBackLink } from '../shared';
import type { Inspection, InspectionPhoto } from '../shared';
import { useT } from '../shared/i18n/LanguageContext';

export function CaptureReturnsBOLRoute() {
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
    // Document capture — landscape is legitimate, so skip the portrait check.
    const quality = await checkImageQuality(blob, { allowLandscape: true });
    if (!quality.passed) {
      const previewUrl = URL.createObjectURL(blob);
      setPending({ blob, previewUrl, issues: quality.issues });
      return;
    }
    await processReturnsBOL(blob);
  });

  async function processReturnsBOL(blob: Blob) {
    if (!inspection) return;

    const bitmap = await createImageBitmap(blob);
    const photo: InspectionPhoto = {
      id: generateId(),
      capturedAt: new Date().toISOString(),
      capturedBy: inspection.startedBy || 'unknown',
      category: 'Returns_BOL',
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
      const currentReturnsBol = inspection.returnsBol || {
        photoIds: [],
        bolNumber: { value: null, source: 'empty' },
        receivedDate: { value: null, source: 'empty' },
        expectedPallets54x40: { value: null, source: 'empty' },
        expectedEmptySeedPaks: { value: null, source: 'empty' },
        expectedPallets40x40: { value: null, source: 'empty' },
        expectedProductSeedPaks: { value: null, source: 'empty' },
        expectedBaggedProduct: { value: null, source: 'empty' },
      };
      
      const updatedReturnsBol = { ...currentReturnsBol };
      updatedReturnsBol.photoIds = [...(updatedReturnsBol.photoIds || []), photo.id];

      const updated: Inspection = {
        ...inspection,
        returnsBol: updatedReturnsBol,
        lastEditedAt: new Date().toISOString(),
      };
      await dbSaveInspection(updated);
      navigate(`/inspection/${inspection.id}/capture-returns-staging`);
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
    await processReturnsBOL(blob);
  };

  const skipToVerify = async () => {
    if (!inspection) return;
    navigate(`/inspection/${inspection.id}/capture-returns-staging`);
  };

  if (!inspection) return null;

  return (
    <main style={{ maxWidth: 560 }}>
      <StepBackLink to={`/inspection/${inspection.id}/details`} />

      <div className="page-head">
        <div>
          <h1 className="page-head__title">
            {t('returnsBol.titleLead', 'Capture')} <em>{t('returnsBol.titleEm', 'Returns BOL')}</em>
          </h1>
          <div className="page-head__sub">
            {t('returnsBol.subtitle', 'Step 2 of 5 · Photograph the Returns BOL & Packing List')}
          </div>
        </div>
      </div>

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
            ? t('returnsBol.analyzing', 'Analyzing Returns BOL…')
            : t('returnsBol.noPhoto', 'No photo yet')}
        </div>
      </div>

      <div className="banner banner--info">
        <span className="banner__icon">i</span>
        <div className="banner__body">
          {t('returnsBol.hint', 'Please take a picture of the Returns BOL.')}
        </div>
      </div>

      <button
        className="btn btn--accent btn--lg"
        onClick={capture}
        disabled={analyzing}
        style={{ width: '100%' }}
      >
        📷 {t('returnsBol.takePhoto', 'Take photo')}
      </button>

      <div className="center mt-16">
        <button className="btn btn--ghost" onClick={skipToVerify}>
          {t('returnsBol.skipManual', 'Skip — enter data manually')}
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
