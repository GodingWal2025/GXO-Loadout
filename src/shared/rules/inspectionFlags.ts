import type { Inspection, QualityFlag, QualityFlagReason } from '../types/inspection';
import { isPackagingLine, picklistHasOcr } from '../types/inspection';
import { expectedBags } from './uomRules';

/** Count scanned quantities above the picklist requirement. */
export function countQuantityOverages(inspection: Inspection): number {
  const lines = Array.isArray(inspection.picklist?.lineItems)
    ? inspection.picklist.lineItems
    : [];
  const excludePackaging = Boolean(
    inspection.type === 'outbound' &&
    lines.length > 0 &&
    inspection.picklist &&
    picklistHasOcr(inspection.picklist)
  );

  return lines.filter((line) => {
    if (line.cancelled || (excludePackaging && isPackagingLine(line))) return false;
    const expected = expectedBags(
      line.uom,
      line.expectedQuantity?.value,
      line.description?.value
    );
    const actual = Number(line.actualQuantity) || 0;
    return expected > 0 && actual > expected;
  }).length;
}

export type InspectionFlagSource =
  | 'inspection'
  | 'unlisted_batch'
  | 'pallet'
  | 'pallet_photo'
  | 'staging_photo'
  | 'quantity_overage';

export interface InspectionFlagItem {
  id: string;
  source: InspectionFlagSource;
  reason?: QualityFlagReason;
  otherReason?: string;
  notes?: string;
  flaggedBy?: string;
  flaggedAt?: string;
  palletNumber?: number;
  batchCode?: string;
  photoCategory?: string;
  actual?: number;
  expected?: number;
}

function qualityFlagFields(flag: QualityFlag): Pick<
  InspectionFlagItem,
  'reason' | 'otherReason' | 'notes' | 'flaggedBy' | 'flaggedAt'
> {
  return {
    reason: flag.reason,
    otherReason: flag.otherReason,
    notes: flag.notes,
    flaggedBy: flag.flaggedBy,
    flaggedAt: flag.flaggedAt,
  };
}

/** Return every issue represented by the order's flagged badge. */
export function listInspectionFlags(inspection: Inspection): InspectionFlagItem[] {
  const flags: InspectionFlagItem[] = [];

  if (inspection.qualityFlag) {
    flags.push({
      id: 'inspection',
      source: 'inspection',
      ...qualityFlagFields(inspection.qualityFlag),
    });
  }

  const lines = Array.isArray(inspection.picklist?.lineItems)
    ? inspection.picklist.lineItems
    : [];
  for (const line of lines) {
    if (line.picklistException?.reason !== 'not_on_original_picklist') continue;
    flags.push({
      id: `unlisted-${line.id}`,
      source: 'unlisted_batch',
      batchCode: line.batchCode?.value || undefined,
      flaggedBy: line.picklistException.addedBy,
      flaggedAt: line.picklistException.addedAt,
    });
  }

  for (const [palletIndex, pallet] of (inspection.pallets || []).entries()) {
    if (pallet.qualityFlag) {
      flags.push({
        id: `pallet-${palletIndex}`,
        source: 'pallet',
        palletNumber: pallet.palletNumber || palletIndex + 1,
        ...qualityFlagFields(pallet.qualityFlag),
      });
    }
    for (const [photoIndex, photo] of (pallet.photos || []).entries()) {
      if (!photo.qualityFlag) continue;
      flags.push({
        id: `pallet-photo-${photo.id || `${palletIndex}-${photoIndex}`}`,
        source: 'pallet_photo',
        palletNumber: pallet.palletNumber || palletIndex + 1,
        photoCategory: photo.category,
        ...qualityFlagFields(photo.qualityFlag),
      });
    }
  }

  const staging = inspection.staging;
  const stagingPhotos = [
    ...(staging?.overviewPhotos || []),
    ...(staging?.coverSheetPhotos || []),
    ...(staging?.finalLanePhotos || []),
    ...(staging?.palletsPackagingPhotos || []),
    ...(staging?.seedpaksPackagingPhotos || []),
  ];
  for (const [photoIndex, photo] of stagingPhotos.entries()) {
    if (!photo.qualityFlag) continue;
    flags.push({
      id: `staging-photo-${photo.id || photoIndex}`,
      source: 'staging_photo',
      photoCategory: photo.category,
      ...qualityFlagFields(photo.qualityFlag),
    });
  }

  const excludePackaging = Boolean(
    inspection.type === 'outbound' &&
    lines.length > 0 &&
    inspection.picklist &&
    picklistHasOcr(inspection.picklist)
  );
  for (const line of lines) {
    if (line.cancelled || (excludePackaging && isPackagingLine(line))) continue;
    const expected = expectedBags(
      line.uom,
      line.expectedQuantity?.value,
      line.description?.value
    );
    const actual = Number(line.actualQuantity) || 0;
    if (expected <= 0 || actual <= expected) continue;
    flags.push({
      id: `overage-${line.id}`,
      source: 'quantity_overage',
      batchCode: line.batchCode?.value || undefined,
      actual,
      expected,
    });
  }

  return flags;
}

/** Rebuild the complete order flag count from its underlying data. */
export function countInspectionFlags(inspection: Inspection): number {
  return listInspectionFlags(inspection).length;
}
