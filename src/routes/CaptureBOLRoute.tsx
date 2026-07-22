import { generateId, compressPhoto } from '../shared';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { dbGetInspection, dbSavePhotoBlob, dbSaveInspection } from '../shared';
import { useCameraCapture } from '../shared';
import { useEffect } from 'react';

import { checkImageQuality, type QualityIssue } from '../shared';
import { ImageQualityModal } from '../shared';
import { StepBackLink } from '../shared';
import type { Inspection, InspectionPhoto } from '../shared';
import { CapturedPageThumb } from '../components/CapturedPageThumb';
import { useT } from '../shared/i18n/LanguageContext';

export function CaptureBOLRoute() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [saving, setSaving] = useState(false);
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
    // A BOL is a document — landscape is a legitimate way to shoot it, so the
    // portrait check is skipped here.
    const quality = await checkImageQuality(blob, { allowLandscape: true });
    if (!quality.passed) {
      const previewUrl = URL.createObjectURL(blob);
      setPending({ blob, previewUrl, issues: quality.issues });
      return;
    }
    await addPage(blob);
  });

  async function addPage(blob: Blob) {
    if (!inspection) return;
    setSaving(true);
    try {
      const compressed = await compressPhoto(blob);
      const bitmap = await createImageBitmap(compressed);
      const photo: InspectionPhoto = {
        id: generateId(),
        capturedAt: new Date().toISOString(),
        capturedBy: inspection.startedBy || 'unknown',
        category: 'BOL',
        localBlobUrl: URL.createObjectURL(compressed),
        metadata: {
          deviceModel: navigator.userAgent.includes('iPad') ? 'iPad' : 'web',
          orientation: bitmap.width > bitmap.height ? 'landscape' : 'portrait',
          originalWidth: bitmap.width,
          originalHeight: bitmap.height,
          fileSizeBytes: compressed.size,
        },
      };

      await dbSavePhotoBlob(photo.id, inspection.id, compressed);

      const updated: Inspection = {
        ...inspection,
        bol: { ...inspection.bol, photoIds: [...inspection.bol.photoIds, photo.id] },
        lastEditedAt: new Date().toISOString(),
      };
      await dbSaveInspection(updated);
      setInspection(updated);
    } finally {
      setSaving(false);
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
    await addPage(blob);
  };

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
            'Photograph the BOL first — it determines how many stops and deliveries are on this load. Add a page for each sheet, then continue.'
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
