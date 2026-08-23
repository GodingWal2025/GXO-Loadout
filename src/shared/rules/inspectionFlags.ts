import type { Inspection } from '../types/inspection';
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

/** Rebuild the complete order flag count from its underlying data. */
export function countInspectionFlags(inspection: Inspection): number {
  let count = inspection.qualityFlag ? 1 : 0;

  for (const pallet of inspection.pallets || []) {
    if (pallet.qualityFlag) count++;
    for (const photo of pallet.photos || []) {
      if (photo.qualityFlag) count++;
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
  for (const photo of stagingPhotos) {
    if (photo.qualityFlag) count++;
  }

  return count + countQuantityOverages(inspection);
}
