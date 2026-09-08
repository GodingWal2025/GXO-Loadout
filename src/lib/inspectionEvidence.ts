import type { Inspection } from '../shared/types/inspection';
import { dbGetPhotoBlob } from '../shared/services/db';
import { listInspectionFlags } from '../shared/rules/inspectionFlags';
import { reconcileInspection, inspectionReadiness } from '../shared/rules/operations';
import type { TranslateFn } from '../shared/i18n/LanguageContext';

export function evidencePhotoIds(inspection: Inspection): string[] {
  return [...new Set([
    ...inspection.picklist.photoIds, ...inspection.bol.photoIds,
    ...(inspection.returnsBol?.photoIds || []), ...(inspection.inbound?.photoIds || []),
    ...(inspection.inbound?.lineItems || []).flatMap(line => line.damagePhotoIds || []),
    ...inspection.pallets.flatMap(pallet => pallet.photos.map(photo => photo.id)),
    ...[inspection.staging.overviewPhotos, inspection.staging.coverSheetPhotos, inspection.staging.finalLanePhotos, inspection.staging.palletsPackagingPhotos || [], inspection.staging.seedpaksPackagingPhotos || []].flat().map(photo => photo.id),
  ])];
}

export const escapeEvidenceHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

/** Export the record and its evidence together; missing images are never hidden. */
export async function buildInspectionEvidence(inspection: Inspection, t: TranslateFn): Promise<{ blob: Blob; missing: number }> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const labels = new Map<string, string>();
  const documentGroups = [
    ['Picklist', inspection.picklist.photoIds], ['BOL', inspection.bol.photoIds],
    ['Returns BOL', inspection.returnsBol?.photoIds || []], ['Inbound BOL', inspection.inbound?.photoIds || []],
  ] as const;
  for (const [label, ids] of documentGroups) ids.forEach((id, index) => labels.set(id, label + ' ' + (index + 1)));
  for (const pallet of inspection.pallets) for (const photo of pallet.photos) labels.set(photo.id, 'Pallet ' + pallet.palletNumber + ' / ' + (photo.slotKey || photo.category) + ' / ' + (photo.capturedAt || '') + ' / ' + (photo.capturedBy || ''));
  const photos: { id: string; label: string; path?: string; missing?: boolean }[] = [];
  for (const [index, id] of evidencePhotoIds(inspection).entries()) {
    try {
      let blob = await dbGetPhotoBlob(id);
      if (!blob) {
        const response = await fetch(`/api/photos/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error('Photo unavailable');
        blob = await response.blob();
      }
      if (!blob.type.startsWith('image/')) throw new Error('Not an image');
      const extension = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
      const path = `photos/${index + 1}.${extension}`;
      zip.file(path, await blob.arrayBuffer());
      photos.push({ id, label: labels.get(id) || id, path });
    } catch { photos.push({ id, label: labels.get(id) || id, missing: true }); }
  }
  const issues = inspectionReadiness(inspection, t);
  const rows = reconcileInspection(inspection);
  const e = escapeEvidenceHtml;
  const title = t('ops.evidenceTitle', 'Inspection evidence package');
  const missingLabel = t('ops.evidenceMissing', 'Image unavailable — reconnect and export again');
  const table = rows.map(row => `<tr>${[row.delivery, row.sku, row.batch, row.description, row.unknownExpected ? '—' : row.expected, row.actual, row.unit].map(cell => `<td>${e(cell)}</td>`).join('')}</tr>`).join('');
  const noteList = [...(inspection.operationalNotes || []).map(note => `${note.at} · ${note.by} · ${note.kind}: ${note.text}`), ...(inspection.handoffLog || []).map(entry => `${entry.at} · ${entry.fromInspector || ''} → ${entry.toInspector}: ${entry.note || ''}`)];
  const findings = [
    ...listInspectionFlags(inspection).map(flag => [flag.source, flag.reason, flag.otherReason, flag.notes, flag.flaggedBy, flag.flaggedAt].filter(Boolean).join(' · ')),
    ...inspection.pallets.filter(pallet => pallet.findings || pallet.failureReason || pallet.rejectedNotes).map(pallet => ['Pallet ' + pallet.palletNumber, pallet.findings, pallet.failureReason, pallet.rejectedNotes].filter(Boolean).join(' · ')),
  ];
  const manifest = { inspectionId: inspection.id, exportedAt: new Date().toISOString(), complete: photos.every(photo => !photo.missing), photos, issues, findings, reconciliation: rows };
  // Session-only blob URLs are not portable and should not appear as evidence links.
  zip.file('inspection.json', JSON.stringify(inspection, (key, value) => key === 'localBlobUrl' ? undefined : value, 2));
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('index.html', `<!doctype html><html><meta charset="utf-8"><title>${e(title)}</title><style>body{font:16px system-ui;max-width:1100px;margin:30px auto;padding:20px;color:#222}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:8px;text-align:left}img{max-width:100%;max-height:700px}pre{white-space:pre-wrap}figure{break-inside:avoid}li{margin:8px 0}</style><h1>${e(title)}</h1><p>${e(inspection.id)} · ${e(inspection.type)} · ${e(inspection.status)}</p><p>${e(inspection.startedAt)} → ${e(inspection.completedAt || '')} · ${e(inspection.startedBy)} / ${e(inspection.completedBy)}</p><p>${e(inspection.picklist.loadNumber.value || inspection.bol.loadNumber.value || inspection.inbound?.bolNumber.value || inspection.returnsBol?.bolNumber.value)} · ${e(inspection.stagingLocation)}</p><h2>${e(t('ops.reconciliation', 'Expected versus actual'))}</h2><table><tr>${[t('ops.delivery', 'Delivery'), 'SKU', t('ops.batch', 'Batch'), t('ops.product', 'Product'), t('ops.expected', 'Expected'), t('ops.actual', 'Actual'), t('ops.unit', 'Unit')].map(label => `<th>${e(label)}</th>`).join('')}</tr>${table}</table><h2>${e(t('ops.openIssues', 'Items needing attention'))}</h2><ul>${issues.map(issue => `<li>${e(issue.label)}</li>`).join('')}</ul><ul>${findings.map(finding => `<li>${e(finding)}</li>`).join('')}</ul><h2>${e(t('ops.notes', 'Handoff and resolution notes'))}</h2><ul>${noteList.map(note => `<li>${e(note)}</li>`).join('')}</ul><h2>${e(t('ops.evidencePhotos', 'Paperwork and pallet photos'))}</h2>${photos.map(photo => `<figure><figcaption>${e(photo.label)} · ${e(photo.id)}</figcaption>${photo.path ? `<img loading="lazy" src="${photo.path}" alt="${e(photo.id)}">` : `<p>${e(missingLabel)}</p>`}</figure>`).join('')}<p>${e(t('ops.evidenceReadme', 'Extract the ZIP and open index.html. The full inspection record and photo manifest are included as JSON.'))}</p></html>`);
  const blob = await zip.generateAsync({ type: 'blob' });
  return { blob, missing: photos.filter(photo => photo.missing).length };
}

export async function downloadInspectionEvidence(inspection: Inspection, t: TranslateFn): Promise<number> {
  const { blob, missing } = await buildInspectionEvidence(inspection, t);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `inspection-${inspection.id.replace(/[^a-zA-Z0-9_-]/g, '_')}-evidence.zip`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return missing;
}
