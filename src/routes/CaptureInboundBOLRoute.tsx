import { generateId, compressPhoto } from '../shared';
import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { dbGetInspection, dbSavePhotoBlob, dbSaveInspection } from '../shared';
import { useCameraCapture } from '../shared';

import { checkImageQuality, type QualityIssue } from '../shared';
import { ImageQualityModal } from '../shared';
import { StepBackLink } from '../shared';
import type { Inspection, InspectionPhoto, InboundData } from '../shared';
import { CapturedPageThumb } from '../components/CapturedPageThumb';
import { useT } from '../shared/i18n/LanguageContext';

export function CaptureInboundBOLRoute() {
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
    // Document capture — landscape is legitimate, skip portrait requirement
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
        category: 'Inbound_BOL',
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

      const currentInbound: InboundData = inspection.inbound || {
        photoIds: [],
        bolNumber: { value: null, source: 'empty' },
        deliveryNumber: { value: null, source: 'empty' },
        stagingLane: { value: inspection.stagingLocation || null, source: 'manual' },
        dateReceived: { value: new Date().toISOString().split('T')[0], source: 'manual' },
        dateVerified: { value: new Date().toISOString().split('T')[0], source: 'manual' },
        verifier: { value: inspection.startedBy || null, source: 'manual' },
        lineItems: [],
      };

      const updatedInbound: InboundData = {
        ...currentInbound,
        photoIds: [...(currentInbound.photoIds || []), photo.id],
      };

      const updated: Inspection = {
        ...inspection,
        inbound: updatedInbound,
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

  const pageIds = inspection.inbound?.photoIds || [];
  const goNext = () => navigate(`/inspection/${inspection.id}/verify-inbound`);

  return (
    <main style={{ maxWidth: 560 }}>
      <StepBackLink to={`/inspection/${inspection.id}/details`} />

      <div className="page-head">
        <div>
          <h1 className="page-head__title">
            {t('inboundBol.titleLead', 'Capture')} <em>{t('inboundBol.titleEm', 'Inbound BOL')}</em>
          </h1>
          <div className="page-head__sub">
            {t('inboundBol.subtitle', 'Step 2 of 3 · Photograph the Bill of Lading / packing document')}
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
            {saving ? t('inboundBol.saving', 'Saving…') : t('inboundBol.noPages', 'No pages yet')}
          </div>
        </div>
      ) : (
        <div className="field" style={{ marginBottom: 20 }}>
          <div className="field__label">
            {pageIds.length === 1
              ? t('inboundBol.pagesOne', '1 page captured')
              : t('inboundBol.pagesMany', '{count} pages captured', { count: pageIds.length })}
          </div>
          <div className="photo-grid">
            {pageIds.map((pid, i) => (
              <CapturedPageThumb
                key={pid}
                photoId={pid}
                inspectionId={inspection.id}
                label={t('inboundBol.pageLabel', 'Page {n}', { n: i + 1 })}
              />
            ))}
          </div>
        </div>
      )}

      <div className="banner banner--info">
        <span className="banner__icon">i</span>
        <div className="banner__body">
          {t(
            'inboundBol.hint',
            'Photograph the BOL for the record. Add a page for each sheet, then proceed to log the received product.'
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
          ? t('inboundBol.takePhoto', 'Take photo')
          : t('inboundBol.addPage', 'Add another page')}
      </button>

      {pageIds.length > 0 && (
        <button
          className="btn btn--lg mt-16"
          onClick={goNext}
          disabled={saving}
          style={{ width: '100%' }}
        >
          {t('inboundBol.continue', 'Continue → Inbound Verification Log')}
        </button>
      )}

      <div className="center mt-16">
        <button className="btn btn--ghost" onClick={goNext}>
          {pageIds.length === 0
            ? t('inboundBol.skipManual', 'Skip — enter BOL data manually')
            : t('inboundBol.skipRest', 'Skip rest')}
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
