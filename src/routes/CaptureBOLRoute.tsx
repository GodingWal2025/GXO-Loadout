import {
  generateId,
  compressPhoto,
  dbGetInspection,
  dbSavePhotoBlob,
  dbSaveInspection,
  ImageQualityModal,
  StepBackLink,
  type Inspection,
  type BOLData,
} from '../shared';
import { useQualityCheckedCapture } from '../shared/camera/useQualityCheckedCapture';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { CapturedPageThumb } from '../components/CapturedPageThumb';
import { useT } from '../shared/i18n/LanguageContext';

export function CaptureBOLRoute() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    dbGetInspection(id).then((i) => {
      if (!i) navigate('/');
      else setInspection(i);
    });
  }, [id, navigate]);

  const { capture, pending, handleRetake, handleKeep } = useQualityCheckedCapture(
    addPage,
    { allowLandscape: true },
  );

  async function addPage(blob: Blob) {
    if (!inspection) return;
    setSaving(true);
    try {
      const compressed = await compressPhoto(blob);
      // Document records store photo IDs; the image itself lives in IndexedDB.
      const photoId = generateId();
      await dbSavePhotoBlob(photoId, inspection.id, compressed);

      // The BOL is photographed for the record only — its line items and header
      // are entered later, by hand, at review time. No OCR runs here.
      const updatedBol: BOLData = {
        ...inspection.bol,
        photoIds: [...inspection.bol.photoIds, photoId],
      };

      const updated: Inspection = {
        ...inspection,
        bol: updatedBol,
        lastEditedAt: new Date().toISOString(),
      };
      await dbSaveInspection(updated);
      setInspection(updated);
    } finally {
      setSaving(false);
    }
  }

  if (!inspection) return null;

  const pageIds = inspection.bol.photoIds;
  const goNext = () => navigate(`/inspection/${inspection.id}/capture-picklist`);

  return (
    <main style={{ maxWidth: 560 }}>
      <StepBackLink to={`/inspection/${inspection.id}/details`} />

      <div className="page-head">
        <div>
          <h1 className="page-head__title">
            {t('bol.titleLead', 'Capture')} <em>{t('bol.titleEm', 'BOL')}</em>
          </h1>
          <div className="page-head__sub">
            {t('bol.subtitle', 'Step 2 of 4 · Photograph the Bill of Lading first')}
          </div>
        </div>
      </div>

      {pageIds.length === 0 ? (
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
            {saving ? t('bol.saving', 'Saving…') : t('bol.noPages', 'No pages yet')}
          </div>
        </div>
      ) : (
        <div className="field" style={{ marginBottom: 20 }}>
          <div className="field__label">
            {pageIds.length === 1
              ? t('bol.pageCaptured', '{count} page captured', { count: pageIds.length })
              : t('bol.pagesCaptured', '{count} pages captured', { count: pageIds.length })}
            {saving ? t('bol.savingSuffix', ' · saving…') : ''}
          </div>
          <div className="photo-grid">
            {pageIds.map((pid, i) => (
              <CapturedPageThumb
                key={pid}
                photoId={pid}
                inspectionId={inspection.id}
                label={t('bol.pageLabel', 'Page {n}', { n: i + 1 })}
              />
            ))}
          </div>
        </div>
      )}

      <div className="banner banner--info">
        <span className="banner__icon">i</span>
        <div className="banner__body">
          {t(
            'bol.hint',
            'Photograph the BOL for the record. Add a page for each sheet — the BOL details are entered later. Then continue.'
          )}
        </div>
      </div>

      <button
        className="btn btn--accent btn--lg"
        onClick={capture}
        disabled={saving}
        style={{ width: '100%' }}
      >
        📷{' '}
        {pageIds.length === 0
          ? t('bol.takePhoto', 'Take photo')
          : t('bol.addPage', 'Add another page')}
      </button>

      {pageIds.length > 0 && (
        <button
          className="btn btn--lg mt-16"
          onClick={goNext}
          disabled={saving}
          style={{ width: '100%' }}
        >
          {t('bol.continue', 'Continue → Capture picklist')}
        </button>
      )}

      <div className="center mt-16">
        <button className="btn btn--ghost" onClick={goNext}>
          {pageIds.length === 0
            ? t('bol.skipManual', 'Skip — enter BOL data manually')
            : t('bol.skipRest', 'Skip rest')}
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
