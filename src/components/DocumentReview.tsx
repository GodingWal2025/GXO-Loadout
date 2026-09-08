import { useEffect, useState } from 'react';
import type { Inspection, PicklistLineItemEntry } from '../shared/types/inspection';
import { PICKLIST_UOM_OPTIONS } from '../shared/types/inspection';
import { dbGetPhotoBlob } from '../shared/services/db';
import { useT } from '../shared/i18n/LanguageContext';

export function needsDocumentReview(line: PicklistLineItemEntry): boolean {
  return !line.cancelled && !line.reviewedAt && [line.sku, line.batchCode, line.description, line.expectedQuantity].some(field => field.source === 'ml');
}

export function DocumentReview({ inspection, onChange }: { inspection: Inspection; onChange: (index: number, patch: Partial<PicklistLineItemEntry>) => void }) {
  const t = useT();
  const ids = [...inspection.picklist.photoIds, ...inspection.bol.photoIds];
  const [selected, setSelected] = useState(ids[0] || '');
  const [url, setUrl] = useState('');
  const [imageError, setImageError] = useState(false);
  const [onlyUnconfirmed, setOnlyUnconfirmed] = useState(false);
  useEffect(() => {
    let active = true;
    let local: string | undefined;
    setUrl(''); setImageError(false);
    if (selected) void dbGetPhotoBlob(selected).then(blob => {
      if (!active) return;
      local = blob ? URL.createObjectURL(blob) : undefined;
      setUrl(local || `/api/photos/${encodeURIComponent(selected)}`);
    }).catch(() => { if (active) setUrl(`/api/photos/${encodeURIComponent(selected)}`); });
    return () => { active = false; if (local) URL.revokeObjectURL(local); };
  }, [selected]);
  return <details className="section" open={inspection.picklist.lineItems.some(needsDocumentReview)}>
    <summary>{t('ops.documentReview', 'Review the image beside the extracted fields')}</summary>
    <p>{t('ops.reviewHint', 'Check highlighted rows against the page, correct any field, then confirm the row. Corrections are saved without retaking the photo.')}</p>
    <div className="document-review">
      <div className="document-review__image">
        <label>{t('ops.sourcePage', 'Source page')}<select value={selected} onChange={event => setSelected(event.target.value)}>{ids.map((id, index) => <option key={id} value={id}>{index < inspection.picklist.photoIds.length ? t('verify.picklistLead', 'Picklist') : t('bol.titleEm', 'BOL')} {index + 1}</option>)}</select></label>
        {url && !imageError && <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={t('ops.sourceImage', 'Captured document — open to zoom')} onError={() => setImageError(true)} /></a>}
        {(!ids.length || imageError) && <p>{t('ops.noSourceImage', 'Image unavailable. Reconnect to load the cloud copy, or enter the fields manually.')}</p>}
      </div>
      <div>
        <label><input type="checkbox" checked={onlyUnconfirmed} onChange={event => setOnlyUnconfirmed(event.target.checked)} /> {t('ops.onlyUnconfirmed', 'Only rows needing confirmation')}</label>
        {inspection.picklist.lineItems.map((line, index) => {
          if (line.cancelled || (onlyUnconfirmed && !needsDocumentReview(line))) return null;
          return <fieldset className={needsDocumentReview(line) ? 'document-row document-row--review' : 'document-row'} key={line.id}>
            <legend>{t('ops.row', 'Row {n}', { n: index + 1 })} {needsDocumentReview(line) && t('ops.needsConfirmation', '— check OCR')}</legend>
            <label>SKU<input value={line.sku.value || ''} onChange={event => onChange(index, { sku: { value: event.target.value, source: 'manual' } })} /></label>
            <label>{t('ops.batch', 'Batch')}<input value={line.batchCode.value || ''} onChange={event => onChange(index, { batchCode: { value: event.target.value, source: 'manual' } })} /></label>
            <label>{t('ops.product', 'Product')}<input value={line.description.value || ''} onChange={event => onChange(index, { description: { value: event.target.value, source: 'manual' } })} /></label>
            <label>{t('ops.expected', 'Expected')}<input type="number" min={0} step="any" value={line.expectedQuantity.value ?? ''} onChange={event => onChange(index, { expectedQuantity: { value: event.target.value === '' ? null : Number(event.target.value), source: 'manual' } })} /></label>
            <label>{t('ops.unit', 'Unit')}<select value={line.uom} onChange={event => onChange(index, { uom: event.target.value as PicklistLineItemEntry['uom'] })}>{PICKLIST_UOM_OPTIONS.map(unit => <option key={unit}>{unit}</option>)}</select></label>
            <label><input type="checkbox" checked={Boolean(line.reviewedAt)} onChange={event => onChange(index, { reviewedAt: event.target.checked ? new Date().toISOString() : undefined })} /> {t('ops.rowConfirmed', 'Checked against the document')}</label>
          </fieldset>;
        })}
      </div>
    </div>
  </details>;
}
