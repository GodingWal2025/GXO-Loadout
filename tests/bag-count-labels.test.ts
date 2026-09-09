import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
// Standalone browser module is intentionally unbundled alongside the console.
// @ts-ignore
import { saveLabel, loadLabels, exportLabels, faceRecord } from '../public/bag-count-labels.js';

const image = (extra = {}) => ({ name: 'pallet__FRONT.jpg', palletId: 'sample_12345', photoId: 'photo_12345',
  physicalPalletGroup: 'physical_12345', role: 'FRONT', imageHash: 'a'.repeat(64), w: 100, h: 100,
  boxes: [], status: 'reviewed', humanCount: 0, verifier: 'Verifier A', reason: 'Visible face checked', ...extra });

describe('persistent four-face labels', () => {
  it('restores boxes and photo bytes across separately opened database sessions', async () => {
    const record = { ...image(), key: 'persistence', blob: new Blob(['photo bytes']), boxes: [{x:1,y:2,w:3,h:4,cls:0}], humanCount: 1 };
    await saveLabel(record);
    const restored = (await loadLabels()).find((r: any) => r.key === 'persistence');
    expect(restored.boxes).toEqual(record.boxes);
    expect(await restored.blob.text()).toBe('photo bytes');
    expect(restored.physicalPalletGroup).toBe('physical_12345');
  });
  it('exports a reviewed zero-flap face while excluding unresolved, top, and unreviewed images', () => {
    const data = exportLabels([image(), image({ status: 'unreviewed' }), image({ status: 'unresolved' }), image({ role: 'TOP' })]);
    expect(data.images).toHaveLength(1);
    expect(data.annotations).toEqual([]);
    expect(data.images[0]).toMatchObject({ pallet_group_id: 'physical_12345', sha256: 'a'.repeat(64), visible_count: 0 });
    expect(data.info.excludedImages).toBe(3);
  });
  it('does not export mismatched human counts or silently manufacture masks', () => {
    expect(() => exportLabels([image({ humanCount: 2 })])).toThrow();
    const im = image({ boxes: [{x:1,y:2,w:3,h:4,cls:0}], humanCount: 1 });
    expect(exportLabels([im]).annotations[0]).not.toHaveProperty('segmentation');
    expect(faceRecord(im).boxes).toEqual(im.boxes);
  });
});
