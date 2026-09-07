import {
  generateId,
  dbGetInspection,
  dbSavePhotoBlob,
  dbSaveInspection,
  ImageQualityModal,
  StepBackLink,
  type Inspection,
} from '../shared';
import { useQualityCheckedCapture } from '../shared/camera/useQualityCheckedCapture';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useT } from '../shared/i18n/LanguageContext';

export function CaptureReturnsBOLRoute() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    if (!id) return;
    dbGetInspection(id).then((i) => {
      if (!i) navigate('/');
      else setInspection(i);
    });
  }, [id, navigate]);

  const { capture, pending, handleRetake, handleKeep } = useQualityCheckedCapture(
    processReturnsBOL,
    { allowLandscape: true },
  );

  async function processReturnsBOL(blob: Blob) {
    if (!inspection) return;

    // Document records store photo IDs; the image itself lives in IndexedDB.
    const photoId = generateId();
    await dbSavePhotoBlob(photoId, inspection.id, blob);

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

      const updatedReturnsBol = {
        ...currentReturnsBol,
        photoIds: [...(currentReturnsBol.photoIds || []), photoId],
      };

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

  const skipToVerify = () => {
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
