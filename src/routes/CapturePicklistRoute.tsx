import {
  generateId,
  mlSuggestable,
  analyzePicklistPhoto,
  compressPhoto,
  explodePicklistLines,
  reconcilePicklistPageBoundary,
  recomputeTallies,
} from '../shared';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { dbGetInspection, dbSavePhotoBlob, dbSaveInspection } from '../shared';
import { useCameraCapture } from '../shared';

import { checkImageQuality, type QualityIssue } from '../shared';
import { ImageQualityModal } from '../shared';
import { StepBackLink } from '../shared';
import type { Inspection, InspectionPhoto, PicklistLineItemEntry } from '../shared';
import { CapturedPageThumb } from '../components/CapturedPageThumb';
import { useT } from '../shared/i18n/LanguageContext';

export function CapturePicklistRoute() {
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
    // A picklist is a document — landscape is a legitimate way to shoot it, so
    // the portrait check is skipped here.
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

    setAnalyzing(true);
    try {
      const compressed = await compressPhoto(blob);
      const bitmap = await createImageBitmap(compressed);
      const photo: InspectionPhoto = {
        id: generateId(),
        capturedAt: new Date().toISOString(),
        capturedBy: inspection.startedBy || 'unknown',
        category: 'Picklist',
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

      const updatedPicklist = { ...inspection.picklist };
      updatedPicklist.photoIds = [...updatedPicklist.photoIds, photo.id];
      let updatedBol = inspection.bol;

      // Best-effort OCR per page, so a multi-page picklist accumulates its
      // line items. Any failure (offline, OCR not configured, parse miss)
      // falls through to manual entry — never blocks the capture flow.
      try {
        const { lineItems: ocrItems, header } = await analyzePicklistPhoto(compressed);

        // Auto-fill the load header from the picklist. Load # / ship date are
        // mirrored onto the BOL (they're the same value) unless the inspector
        // already typed one in — never clobber a manual entry.
        if (header.loadNumber && updatedPicklist.loadNumber.source !== 'manual') {
          updatedPicklist.loadNumber = mlSuggestable(header.loadNumber);
          updatedBol = { ...updatedBol, loadNumber: mlSuggestable(header.loadNumber) };
        }
        if (header.shipDate && updatedPicklist.shipDate.source !== 'manual') {
          updatedPicklist.shipDate = mlSuggestable(header.shipDate);
          updatedBol = { ...updatedBol, shipDate: mlSuggestable(header.shipDate) };
        }

        if (ocrItems.length > 0) {
          // Each line goes under the delivery it was picked for. Deliveries are
          // matched by number across pages, so page 2's lines land under the
          // delivery page 1 already created instead of spawning a duplicate.
          const deliveries = [...updatedBol.deliveries];
          const deliveryIdFor = (rawNumber: string | null): string => {
            const number = (rawNumber ?? header.deliveryNumber ?? '').trim();
            let index = number
              ? deliveries.findIndex((d) => d.deliveryNumber.trim() === number)
              // A page continuation often omits the delivery heading. In that
              // case its rows continue under the most recently seen delivery.
              : deliveries.length - 1;
            // A blank delivery (added by hand, or created before any number was
            // read) adopts the number rather than sitting empty beside it.
            if (index === -1 && number) {
              index = deliveries.findIndex((d) => !d.deliveryNumber.trim());
              if (index !== -1) deliveries[index] = { ...deliveries[index], deliveryNumber: number };
            }
            if (index === -1) {
              deliveries.push({
                id: generateId(),
                deliveryNumber: number,
                stopNumber: deliveries.length + 1,
                lineItemIds: [],
              });
              index = deliveries.length - 1;
            }
            return deliveries[index].id;
          };

          const mapped: PicklistLineItemEntry[] = ocrItems.map((li) => ({
            id: generateId(),
            batchCode: mlSuggestable(li.batchCode),
            sku: mlSuggestable(li.sku),
            description: mlSuggestable(li.description),
            expectedQuantity: mlSuggestable(li.expectedQuantity),
            uom: li.uom,
            deliveryId: deliveryIdFor(li.deliveryNumber),
            actualQuantity: 0,
            fulfilled: false,
          }));
          // SP lines split into one line per SeedPak (see uomRules). Each copy
          // keeps its parent's deliveryId, so the split stays on one delivery.
          const boundary = reconcilePicklistPageBoundary(updatedPicklist.lineItems, mapped);
          const exploded = explodePicklistLines(boundary.incoming);
          updatedPicklist.lineItems = [...boundary.existing, ...exploded];

          // Append the new ids to their delivery — existing assignments from an
          // earlier page stay put.
          updatedBol = {
            ...updatedBol,
            deliveries: deliveries.map((d) => ({
              ...d,
              lineItemIds: [
                ...d.lineItemIds,
                ...exploded
                  .filter((li) => li.deliveryId === d.id && !d.lineItemIds.includes(li.id))
                  .map((li) => li.id),
              ],
            })),
          };
        } else if (header.deliveryNumber && updatedBol.deliveries.length === 0) {
          // Nothing read off this page, but we know the delivery — seed it so
          // the inspector only has to confirm the number.
          updatedBol = {
            ...updatedBol,
            deliveries: [
              {
                id: generateId(),
                deliveryNumber: header.deliveryNumber,
                stopNumber: 1,
                lineItemIds: [],
              },
            ],
          };
        }
      } catch (err) {
        console.warn('[picklist-ocr] extraction skipped:', err);
      }

      const updated = recomputeTallies({
        ...inspection,
        picklist: updatedPicklist,
        bol: updatedBol,
        lastEditedAt: new Date().toISOString(),
      });
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
    await addPage(blob);
  };

  if (!inspection) return null;

  const pageIds = inspection.picklist.photoIds;
  const lineCount = inspection.picklist.lineItems.length;
  const goNext = () => navigate(`/inspection/${inspection.id}/verify`);

  return (
    <main style={{ maxWidth: 560 }}>
      <StepBackLink to={`/inspection/${inspection.id}/capture-bol`} />

      <div className="page-head">
        <div>
          <h1 className="page-head__title">
            {t('picklist.titleLead', 'Capture')} <em>{t('picklist.titleEm', 'picklist')}</em>
          </h1>
          <div className="page-head__sub">
            {t('picklist.subtitle', 'Step 3 of 4 · Photograph the printed picklist')}
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
            {analyzing
              ? t('picklist.analyzing', 'Analyzing picklist…')
              : t('picklist.noPages', 'No pages yet')}
          </div>
        </div>
      ) : (
        <div className="field" style={{ marginBottom: 20 }}>
          <div className="field__label">
            {pageIds.length === 1
              ? t('picklist.pageCaptured', '{count} page captured', { count: pageIds.length })
              : t('picklist.pagesCaptured', '{count} pages captured', { count: pageIds.length })}
            {analyzing ? t('picklist.analyzingSuffix', ' · analyzing…') : ''}
          </div>
          <div className="photo-grid">
            {pageIds.map((pid, i) => (
              <CapturedPageThumb
                key={pid}
                photoId={pid}
                inspectionId={inspection.id}
                label={t('picklist.pageLabel', 'Page {n}', { n: i + 1 })}
              />
            ))}
          </div>
        </div>
      )}

      {lineCount > 0 && (
        <div className="banner banner--info">
          <span className="banner__icon">✨</span>
          <div className="banner__body">
            <strong>
              {lineCount === 1
                ? t('picklist.lineItem', '{count} line item', { count: lineCount })
                : t('picklist.lineItems', '{count} line items', { count: lineCount })}
            </strong>{' '}
            {t(
              'picklist.lineItemsRead',
              "read from the picklist. You'll confirm each one on the next screen."
            )}
          </div>
        </div>
      )}

      <div className="banner banner--info">
        <span className="banner__icon">i</span>
        <div className="banner__body">
          {t(
            'picklist.hint',
            'Photograph the printed picklist. Add a page for each sheet — every page is read for line items, then continue.'
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
        {pageIds.length === 0
          ? t('picklist.takePhoto', 'Take photo')
          : t('picklist.addPage', 'Add another page')}
      </button>

      {pageIds.length > 0 && (
        <button
          className="btn btn--lg mt-16"
          onClick={goNext}
          disabled={analyzing}
          style={{ width: '100%' }}
        >
          {t('picklist.continue', 'Continue → Verify')}
        </button>
      )}

      <div className="center mt-16">
        <button className="btn btn--ghost" onClick={goNext}>
          {pageIds.length === 0
            ? t('picklist.skipManual', 'Skip — enter picklist manually')
            : t('picklist.skipRest', 'Skip rest')}
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
