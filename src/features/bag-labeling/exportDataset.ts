import JSZip from 'jszip';
import { xyxyToPixelXywh } from './coordinates';
import { DATASET_SPLIT_SALT } from './split';
import type { DatasetManifest, PalletLabelGroup } from './types';

interface CocoImage {
  id: number;
  file_name: string;
  width: number;
  height: number;
  pallet_group_id: string;
  split: string;
  view: string;
  target_pallet_box: readonly number[];
}

interface CocoAnnotation {
  id: number;
  image_id: number;
  category_id: number;
  bbox: readonly number[];
  area: number;
  segmentation: { size: readonly [number, number]; counts: string };
  iscrowd: 0;
  attributes: { pallet_group_id: string; source: string };
}

function safeToken(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'PALLET';
}

export function datasetFileName(group: PalletLabelGroup, photoId: string, view: string): string {
  return `${safeToken(group.id)}_${safeToken(view)}_${safeToken(photoId)}.jpg`;
}

export function validateDataset(groups: readonly PalletLabelGroup[]): string[] {
  const errors: string[] = [];
  const hashes = new Map<string, string>();
  for (const group of groups) {
    if (!group.photos.length) errors.push(`${group.displayName}: no photos`);
    for (const photo of group.photos) {
      if (!photo.reviewed) errors.push(`${group.displayName}/${photo.fileName}: not reviewed`);
      if (!photo.targetPalletBox) errors.push(`${group.displayName}/${photo.fileName}: missing pallet box`);
      const duplicate = hashes.get(photo.sha256);
      if (duplicate && duplicate !== group.id) {
        errors.push(`${photo.fileName}: duplicate image appears in pallet groups ${duplicate} and ${group.id}`);
      }
      hashes.set(photo.sha256, group.id);
      for (const flap of photo.flaps.filter((item) => item.status === 'accepted')) {
        if (!flap.segmentationRle?.counts) errors.push(`${photo.fileName}/${flap.id}: missing mask`);
      }
    }
  }
  for (const split of ['train', 'valid', 'test'] as const) {
    if (!groups.some((group) => group.split === split)) errors.push(`No pallet groups assigned to ${split}`);
  }
  return errors;
}

export async function buildDatasetZip(groups: readonly PalletLabelGroup[]): Promise<Blob> {
  const errors = validateDataset(groups);
  if (errors.length) throw new Error(errors.join('\n'));

  const zip = new JSZip();
  const images: CocoImage[] = [];
  const annotations: CocoAnnotation[] = [];
  const manifest: DatasetManifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    splitSalt: DATASET_SPLIT_SALT,
    groups: [],
  };
  let imageId = 1;
  let annotationId = 1;

  for (const group of groups) {
    const manifestPhotos: DatasetManifest['groups'][number]['photos'] = [];
    for (const photo of group.photos) {
      const exportedName = datasetFileName(group, photo.id, photo.view);
      zip.file(`images/${exportedName}`, photo.blob, { binary: true });
      images.push({
        id: imageId,
        file_name: exportedName,
        width: photo.width,
        height: photo.height,
        pallet_group_id: group.id,
        split: group.split,
        view: photo.view,
        target_pallet_box: photo.targetPalletBox!,
      });
      for (const flap of photo.flaps.filter((item) => item.status === 'accepted')) {
        const bbox = xyxyToPixelXywh(flap.bbox, photo.width, photo.height);
        annotations.push({
          id: annotationId++,
          image_id: imageId,
          category_id: 1,
          bbox,
          area: bbox[2] * bbox[3],
          segmentation: flap.segmentationRle,
          iscrowd: 0,
          attributes: { pallet_group_id: group.id, source: 'human_accepted_sam3' },
        });
      }
      manifestPhotos.push({
        id: photo.id,
        fileName: exportedName,
        view: photo.view,
        width: photo.width,
        height: photo.height,
        sha256: photo.sha256,
        reviewed: photo.reviewed,
        targetPalletBox: photo.targetPalletBox,
        acceptedFlaps: photo.flaps.filter((item) => item.status === 'accepted').length,
      });
      imageId++;
    }
    manifest.groups.push({
      id: group.id,
      displayName: group.displayName,
      split: group.split,
      photos: manifestPhotos,
    });
  }

  const coco = {
    info: { description: 'GXO SAM 3 bag-flap dataset', version: '1.0', date_created: manifest.createdAt },
    categories: [{ id: 1, name: 'bag flap', supercategory: 'pallet' }],
    images,
    annotations,
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('annotations/master.coco.json', JSON.stringify(coco, null, 2));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 4 } });
}

export function downloadDataset(blob: Blob): void {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `gxo-pallet-dataset-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function publishDataset(blob: Blob): Promise<{ blobName: string }> {
  const digest = await sha256Hex(blob);
  const sasResponse = await fetch('/api/datasets/sas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ size: blob.size, sha256: digest, contentType: 'application/zip' }),
  });
  if (!sasResponse.ok) throw new Error(`Could not create dataset upload (${sasResponse.status})`);
  const { uploadUrl, blobName } = await sasResponse.json() as { uploadUrl: string; blobName: string };

  const blockIds: string[] = [];
  const blockSize = 4 * 1024 * 1024;
  for (let offset = 0, index = 0; offset < blob.size; offset += blockSize, index++) {
    const blockId = btoa(String(index).padStart(8, '0'));
    blockIds.push(blockId);
    const separator = uploadUrl.includes('?') ? '&' : '?';
    const upload = await fetch(`${uploadUrl}${separator}comp=block&blockid=${encodeURIComponent(blockId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: blob.slice(offset, Math.min(offset + blockSize, blob.size)),
    });
    if (!upload.ok) throw new Error(`Dataset block ${index + 1} upload failed (${upload.status})`);
  }
  const blockList = `<?xml version="1.0" encoding="utf-8"?><BlockList>${blockIds.map((id) => `<Latest>${id}</Latest>`).join('')}</BlockList>`;
  const separator = uploadUrl.includes('?') ? '&' : '?';
  const commit = await fetch(`${uploadUrl}${separator}comp=blocklist`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/xml', 'x-ms-blob-content-type': 'application/zip', 'x-ms-meta-sha256': digest },
    body: blockList,
  });
  if (!commit.ok) throw new Error(`Dataset commit failed (${commit.status})`);

  const finalize = await fetch('/api/datasets/finalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ blobName, size: blob.size, sha256: digest }),
  });
  if (!finalize.ok) throw new Error(`Dataset finalization failed (${finalize.status})`);
  return { blobName };
}
