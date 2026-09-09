// Persistent drafts are separate from the collector queue and legacy labeling DB.
export const LABEL_VERSION = 'four-sides-v1';
export const SIDE_NAMES = ['FRONT', 'RIGHT', 'BACK', 'LEFT'];
export function openLabels() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('bcc-labels-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function labelTransaction(mode, action) {
  const db = await openLabels();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', mode);
    const req = action(tx.objectStore('drafts'));
    tx.oncomplete = () => { db.close(); resolve(req.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error('Label save aborted')); };
  });
}
export const loadLabels = () => labelTransaction('readonly', store => store.getAll());
export const saveLabel = value => labelTransaction('readwrite', store => store.put(value));
export async function imageHash(blob) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), n => n.toString(16).padStart(2, '0')).join('');
}
export function faceRecord(image) {
  return { photoId: image.photoId, role: image.role, imageHash: image.imageHash,
    width: image.w, height: image.h, status: image.status || 'unreviewed',
    reason: image.reason || '', verifier: image.verifier || '', humanCount: image.humanCount ?? null,
    boxes: image.boxes.map(({ x, y, w, h }) => ({ x, y, w, h, cls: 0 })) };
}
export function reviewed(image) {
  return image.status === 'reviewed' && !!image.verifier?.trim() && !!image.reason?.trim()
    && Number.isInteger(image.humanCount) && image.humanCount === image.boxes.length
    && SIDE_NAMES.includes(image.role) && !!image.palletId && !!image.imageHash;
}
export function exportLabels(images) {
  const eligible = images.filter(reviewed);
  if (!eligible.length) throw new Error('No reviewed side images. Confirm the visible count, verifier, and reason first.');
  const coco = { info: { description: 'GXO reviewed four-side bag-flap boxes', schemaVersion: 1,
    annotationType: 'boxes', exportVersion: LABEL_VERSION, date_created: new Date().toISOString(),
    excludedImages: images.length - eligible.length },
    images: [], annotations: [], categories: [{ id: 1, name: 'bag_flap', supercategory: 'pallet' }] };
  for (const im of eligible) {
    const id = coco.images.length + 1;
    coco.images.push({ id, file_name: im.name, width: im.w, height: im.h,
      sample_id: im.palletId, photo_id: im.photoId, pallet_group_id: im.physicalPalletGroup || im.palletId,
      role: im.role, sha256: im.imageHash, review_status: im.status, reviewer: im.verifier,
      review_reason: im.reason, visible_count: im.humanCount });
    for (const b of im.boxes) coco.annotations.push({ id: coco.annotations.length + 1, image_id: id,
      category_id: 1, bbox: [b.x, b.y, b.w, b.h], area: b.w * b.h, iscrowd: 0 });
  }
  return coco;
}
