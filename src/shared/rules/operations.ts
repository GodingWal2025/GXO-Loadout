import type { Inspection, PalletInspection } from '../types/inspection';
import { isPackagingLine, picklistHasOcr } from '../types/inspection';
import { expectedBags, actualCountInUom, actualCountUom } from './uomRules';
import { normalizeBatchCode } from './batchCodeMatching';
import { listInspectionFlags } from './inspectionFlags';
import { requiredPalletPhotos } from './photoRequirements';
import { computeCrossReference } from '../services/crossReference';
import type { TranslateFn } from '../i18n/LanguageContext';

export interface ReconciliationRow {
  id: string;
  sku: string;
  delivery: string;
  batch: string;
  description: string;
  unit: string;
  expected: number;
  actual: number;
  unexpected: boolean;
  unknownExpected: boolean;
}

/** Keep packaging units separate. Never add a Seedpak count to a bag count. */
export function reconcileInspection(inspection: Inspection): ReconciliationRow[] {
  if (inspection.type === 'inbound') {
    return (inspection.inbound?.lineItems || []).map(line => ({
      id: line.id, delivery: inspection.inbound?.deliveryNumber.value || '', sku: line.materialNumber.value || '', batch: line.batch.value || '',
      description: line.materialDescription?.value || '', unit: line.uom,
      expected: 0, actual: line.qtyReceived.value || 0,
      unexpected: !line.onBol, unknownExpected: true,
    }));
  }
  const groups = new Map<string, ReconciliationRow>();
  const excludePackaging = inspection.type === 'outbound' && picklistHasOcr(inspection.picklist);
  const lines = inspection.picklist.lineItems.filter(line => !line.cancelled && !(excludePackaging && isPackagingLine(line)));
  for (const line of lines) {
    const unit = actualCountUom(line.uom);
    const sku = line.sku.value || '';
    const batch = normalizeBatchCode(line.batchCode.value);
    const id = JSON.stringify([sku, batch, unit, line.deliveryId || '']);
    const row = groups.get(id) || {
      id, sku, batch, delivery: inspection.bol.deliveries.find(delivery => delivery.id === line.deliveryId)?.deliveryNumber || line.deliveryId || '', description: line.description.value || '', unit,
      expected: 0, actual: 0, unexpected: false, unknownExpected: false,
    };
    row.expected += actualCountInUom(line.uom, expectedBags(line.uom, line.expectedQuantity.value, line.description.value), line.description.value);
    row.actual += actualCountInUom(line.uom, line.actualQuantity, line.description.value);
    row.unexpected ||= Boolean(line.picklistException);
    row.unknownExpected ||= line.expectedQuantity.value == null;
    groups.set(id, row);
  }
  // Unlisted physical batches still need to be visible before a verifier adds them.
  for (const pallet of inspection.pallets) {
    for (const section of pallet.batchSections) {
      const batch = normalizeBatchCode(section.batchCode.value);
      if (!batch || lines.some(line => normalizeBatchCode(line.batchCode.value) === batch && (!line.deliveryId || line.deliveryId === pallet.deliveryId))) continue;
      const unit = pallet.palletType === 'Seedpak' ? 'SP' : pallet.palletType === 'Minibulk' ? 'MB' : 'BG';
      const id = JSON.stringify(['unlisted', batch, unit, pallet.deliveryId]);
      const row = groups.get(id) || { id, sku: '', batch, delivery: inspection.bol.deliveries.find(delivery => delivery.id === pallet.deliveryId)?.deliveryNumber || pallet.deliveryId || '', description: section.productName.value || '', unit, expected: 0, actual: 0, unexpected: inspection.type !== 'returns', unknownExpected: inspection.type === 'returns' };
      row.actual += unit === 'BG' ? section.actualBagCount.value || 0 : 1;
      groups.set(id, row);
    }
  }
  return [...groups.values()];
}

export interface ReadinessIssue { id: string; label: string; to: string; }

export function flagReasonLabel(reason: string, t: TranslateFn): string {
  const labels: Record<string, string> = {
    damaged_product: t('ops.flagDamage', 'Damaged product'),
    wrong_or_missing_label: t('ops.flagLabel', 'Wrong or missing label'),
    wrong_batch_or_product_info: t('ops.flagBatch', 'Wrong batch or product'),
    quantity_discrepancy: t('ops.flagQuantity', 'Quantity discrepancy'),
    quantity_overage: t('ops.flagOverage', 'Quantity overage'),
    unlisted_batch: t('ops.flagUnlisted', 'Unlisted batch'),
    inspection: t('ops.flagInspection', 'Inspection flag'),
    pallet: t('ops.flagPallet', 'Pallet flag'),
    pallet_photo: t('ops.flagPhoto', 'Photo flag'),
    staging_photo: t('ops.flagStaging', 'Staging photo flag'),
    other: t('ops.flagOther', 'Other issue'),
  };
  return labels[reason] || reason;
}

/** One checklist feeds the workspace, handoff board, supervisor view, and export. */
export function inspectionReadiness(inspection: Inspection, t: TranslateFn): ReadinessIssue[] {
  const base = `/inspection/${inspection.id}`;
  const issues: ReadinessIssue[] = [];
  const add = (id: string, label: string, suffix: string) => issues.push({ id, label, to: base + suffix });
  const inbound = inspection.type === 'inbound';
  const returns = inspection.type === 'returns';
  const documentRoute = inbound ? '/capture-inbound-bol' : returns ? '/capture-returns-bol' : '/capture-bol';
  const verifyRoute = inbound ? '/verify-inbound' : returns ? '/verify-returns' : '/verify';
  const document = inbound ? inspection.inbound : returns ? inspection.returnsBol : inspection.bol;
  if (!document?.photoIds.length) add('document', t('ops.missingDocument', 'Capture the BOL paperwork'), documentRoute);
  const verified = inbound ? inspection.inbound?.verifiedAt : returns ? inspection.returnsBol?.verifiedAt : inspection.picklist.verifiedAt;
  if (!verified) add('verified', t('ops.verify', 'Confirm the document fields and quantities'), verifyRoute);
  if (inspection.type === 'outbound' && !inspection.picklist.photoIds.length) add('picklist', t('ops.missingPicklist', 'Capture the picklist'), '/capture-picklist');
  if (inspection.type === 'outbound') {
    const activeLines = inspection.picklist.lineItems.filter(line => !line.cancelled);
    if (!activeLines.length) add('empty-picklist', t('ops.enterPicklist', 'Enter the expected products and quantities'), '/verify');
    for (const line of activeLines) {
      if (!line.sku.value || (!line.batchCode.value && line.uom !== 'C62') || line.expectedQuantity.value == null || line.expectedQuantity.value < 0) add(`line-${line.id}`, t('ops.incompleteLine', 'Complete the expected product, batch, and quantity'), '/verify');
      if (activeLines.some(other => other.id !== line.id && normalizeBatchCode(other.batchCode.value) === normalizeBatchCode(line.batchCode.value) && other.sku.value !== line.sku.value && line.batchCode.value)) add(`ambiguous-${line.id}`, t('ops.ambiguousBatch', 'Confirm the SKU: batch {batch} appears on multiple products', { batch: line.batchCode.value || '' }), '/verify');
    }
  }
  if (inspection.type === 'outbound' && inspection.bol.lineItems.length && !computeCrossReference(inspection).matches) add('cross-reference', t('ops.crossReference', 'Resolve the BOL and picklist mismatch'), '/review');
  if (inbound) {
    if (!inspection.inbound?.lineItems.length) add('items', t('ops.missingItems', 'Enter the received products'), verifyRoute);
    for (const line of inspection.inbound?.lineItems || []) {
      if (!line.materialNumber.value || !line.batch.value || line.qtyReceived.value == null || (line.qtyReceived.value || 0) < 0) add(`inbound-${line.id}`, t('ops.inboundFields', 'Complete product, batch, and received quantity for item {n}', { n: line.itemNumber }), verifyRoute);
      if ((line.qtyDamaged.value || 0) > 0 && !line.damagePhotoIds?.length) add(`damage-${line.id}`, t('ops.damagePhoto', 'Add damage evidence for item {n}', { n: line.itemNumber }), verifyRoute);
    }
  } else {
    if (!inspection.pallets.length) add('pallets', t('ops.missingPallets', 'Capture the pallets'), '');
    inspection.pallets.forEach((pallet, index) => {
      const to = `/pallet/${index}`;
      const missing = requiredPalletPhotos(pallet.palletType, pallet.batchCount, returns).filter(slot => !pallet.photos.some(photo => photo.slotKey === slot));
      if (missing.length) add(`photos-${index}`, t('ops.palletPhotos', 'Pallet {n}: {count} required photos missing', { n: pallet.palletNumber, count: missing.length }), to);
      if (pallet.batchSections.some(section => !section.batchCode.value?.trim() || section.actualBagCount.value == null || section.actualBagCount.value < 0)) add(`count-${index}`, t('ops.palletFields', 'Pallet {n}: confirm batch and quantity', { n: pallet.palletNumber }), to);
      if (pallet.repeatSourcePallet != null && !pallet.repeatConfirmedAt) add(`repeat-${index}`, t('ops.confirmRepeat', 'Pallet {n}: confirm the carried-forward details', { n: pallet.palletNumber }), to);
      if (pallet.passInspection === 'Fail') add(`failed-${index}`, t('ops.failedPallet', 'Pallet {n}: resolve the failed inspection', { n: pallet.palletNumber }), to);
    });
  }
  for (const row of reconcileInspection(inspection)) {
    if (row.unexpected || (!row.unknownExpected && Math.abs(row.actual - row.expected) > 0.001)) add(`quantity-${row.id}`, t('ops.quantityIssue', 'Review quantity or unexpected product: {batch} / {sku}', { batch: row.batch || '—', sku: row.sku || '—' }), inbound ? verifyRoute : '#reconciliation');
  }
  for (const flag of listInspectionFlags(inspection)) {
    const index = inspection.pallets.findIndex(p => p.palletNumber === flag.palletNumber);
    add(`flag-${flag.id}`, t('ops.flagIssue', 'Review flagged issue: {reason}', { reason: flagReasonLabel(flag.reason || flag.source, t) }), index >= 0 ? `/pallet/${index}` : '/review');
  }
  if (!inbound && !inspection.staging.finalLanePhotos.length) add('staging', t('ops.staging', 'Capture the final staging lane'), returns ? '/capture-returns-staging' : '/review');
  if (!inbound && Object.values(inspection.staging).includes('No')) add('staging-checks', t('ops.stagingChecks', 'Resolve failed staging checks'), '/review');
  return issues;
}

export function lastCompletedStep(inspection: Inspection, t: TranslateFn): string {
  if (inspection.completedAt) return t('ops.stepComplete', 'Inspection completed');
  if (inspection.staging.finalLanePhotos.length) return t('ops.stepStaging', 'Staging photographed');
  if (inspection.pallets.length) return t('ops.stepPallets', '{count} pallets recorded', { count: inspection.pallets.length });
  if (inspection.picklist.verifiedAt || inspection.inbound?.verifiedAt || inspection.returnsBol?.verifiedAt) return t('ops.stepVerified', 'Document data verified');
  if (inspection.picklist.photoIds.length || inspection.bol.photoIds.length || inspection.inbound?.photoIds.length || inspection.returnsBol?.photoIds.length) return t('ops.stepDocuments', 'Paperwork captured');
  return t('ops.stepStarted', 'Inspection started');
}

/** Deliberately copy only reusable product details, never identity or evidence. */
export function repeatPallet(source: PalletInspection, palletNumber: number, newId: () => string): PalletInspection {
  return {
    palletNumber, palletType: source.palletType, deliveryId: source.deliveryId,
    passInspection: 'Pass', accuracyLabelAttached: 'N/A', batchCount: source.batchCount,
    photos: [], repeatSourcePallet: source.palletNumber,
    batchSections: source.batchSections.map(section => ({
      id: newId(), batchCode: { value: section.batchCode.value, source: 'manual' },
      productName: { value: section.productName.value, source: 'manual' },
      expectedBagCount: 0, actualBagCount: { value: null, source: 'empty' },
      bagsPerLayer: section.bagsPerLayer,
    })),
  };
}
