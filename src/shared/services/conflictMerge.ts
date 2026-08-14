// Deterministic Multi-Device Conflict Merge Policies for Loadout

import type { Inspection, InspectionPhoto, PalletInspection, InspectionStatus } from '../types/inspection';
import type { InventoryItem } from '../types/inventory';

const STATUS_PRIORITY: Record<InspectionStatus, number> = {
  PENDING: 1,
  IN_PROGRESS: 2,
  FLAGGED: 3,
  COMPLETED: 4,
  CANCELLED: 0,
};

function resolveStatus(s1?: InspectionStatus, s2?: InspectionStatus): InspectionStatus {
  if (!s1) return s2 || 'PENDING';
  if (!s2) return s1;
  const p1 = STATUS_PRIORITY[s1] ?? 1;
  const p2 = STATUS_PRIORITY[s2] ?? 1;
  return p1 >= p2 ? s1 : s2;
}

/**
 * Merge photos array from two pallets/staging, deduplicating by photo id.
 */
export function mergePhotos(localPhotos: InspectionPhoto[] = [], remotePhotos: InspectionPhoto[] = []): InspectionPhoto[] {
  const photoMap = new Map<string, InspectionPhoto>();

  // Add remote photos first
  for (const p of remotePhotos) {
    if (p && p.id) photoMap.set(p.id, p);
  }

  // Add/overwrite with local photos (preserve newly captured local blob info)
  for (const p of localPhotos) {
    if (!p || !p.id) continue;
    const existing = photoMap.get(p.id);
    if (!existing) {
      photoMap.set(p.id, p);
    } else {
      photoMap.set(p.id, {
        ...existing,
        ...p,
        localBlobUrl: p.localBlobUrl || existing.localBlobUrl,
        sharePointUrl: existing.sharePointUrl || p.sharePointUrl,
      });
    }
  }

  return Array.from(photoMap.values());
}

/**
 * Merge pallets from two inspections deterministically.
 */
export function mergePallets(localPallets: PalletInspection[] = [], remotePallets: PalletInspection[] = []): PalletInspection[] {
  const maxLen = Math.max(localPallets.length, remotePallets.length);
  const merged: PalletInspection[] = [];

  for (let i = 0; i < maxLen; i++) {
    const loc = localPallets[i];
    const rem = remotePallets[i];

    if (!loc && rem) {
      merged.push(rem);
      continue;
    }
    if (loc && !rem) {
      merged.push(loc);
      continue;
    }
    if (!loc && !rem) {
      continue;
    }

    // Both exist: merge fields
    const mergedPhotos = mergePhotos(loc.photos, rem.photos);
    const mergedPallet: PalletInspection = {
      ...rem,
      ...loc,
      palletNumber: loc.palletNumber || rem.palletNumber || i + 1,
      lpnNumber: loc.lpnNumber || rem.lpnNumber,
      palletType: loc.palletType || rem.palletType,
      passInspection: loc.passInspection === 'Fail' || rem.passInspection === 'Fail' ? 'Fail' : 'Pass',
      accuracyLabelAttached: loc.accuracyLabelAttached || rem.accuracyLabelAttached,
      findings: loc.findings || rem.findings,
      photos: mergedPhotos,
      batchSections: loc.batchSections?.length ? loc.batchSections : rem.batchSections,
      batchCount: loc.batchCount || rem.batchCount || 1,
    };
    merged.push(mergedPallet);
  }

  return merged;
}

/**
 * Deterministically merge two conflicting inspection records.
 * Ensures no pallet scans, photos, or line items are lost during concurrent multi-device writes.
 */
export function mergeInspection(local: Inspection, remote: Inspection): Inspection {
  const localTime = local.lastEditedAt || local.completedAt || local.startedAt || '';
  const remoteTime = remote.lastEditedAt || remote.completedAt || remote.startedAt || '';
  const isLocalNewer = localTime >= remoteTime;

  const merged: Inspection = {
    ...(isLocalNewer ? remote : local),
    ...(isLocalNewer ? local : remote),
    id: local.id || remote.id,
    siteId: local.siteId || remote.siteId,
    status: resolveStatus(local.status, remote.status),
    startedAt: local.startedAt || remote.startedAt || new Date().toISOString(),
    pallets: mergePallets(local.pallets, remote.pallets),
    picklist: local.picklist || remote.picklist,
    bol: local.bol || remote.bol,
    staging: {
      ...(remote.staging || {}),
      ...(local.staging || {}),
      overviewPhotos: mergePhotos(local.staging?.overviewPhotos, remote.staging?.overviewPhotos),
      coverSheetPhotos: mergePhotos(local.staging?.coverSheetPhotos, remote.staging?.coverSheetPhotos),
      finalLanePhotos: mergePhotos(local.staging?.finalLanePhotos, remote.staging?.finalLanePhotos),
      palletsPackagingPhotos: mergePhotos(local.staging?.palletsPackagingPhotos, remote.staging?.palletsPackagingPhotos),
      seedpaksPackagingPhotos: mergePhotos(local.staging?.seedpaksPackagingPhotos, remote.staging?.seedpaksPackagingPhotos),
    },
    lastEditedAt: new Date().toISOString(),
  };

  return merged;
}

/**
 * Deterministically merge two conflicting inventory items.
 */
export function mergeInventory(
  local: InventoryItem & { _rev?: number },
  remote: InventoryItem & { _rev?: number }
): InventoryItem & { _rev?: number } {
  const isLocalNewer = (local.lastUpdated || '') >= (remote.lastUpdated || '');
  return {
    ...remote,
    ...local,
    sku: isLocalNewer ? local.sku : (remote.sku || local.sku),
    description: isLocalNewer ? local.description : (remote.description || local.description),
    batch: isLocalNewer ? local.batch : (remote.batch || local.batch),
    lastUpdated: new Date().toISOString(),
  };
}
