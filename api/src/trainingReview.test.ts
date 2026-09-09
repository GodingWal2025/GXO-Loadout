import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpRequest } from '@azure/functions';
import { Readable } from 'node:stream';
const storage = vi.hoisted(() => ({ payload: '', revision: 0 }));
const sample = { id: 'sample_12345', totalBags: 48, photos: [{ id: 'photo_12345', role: 'FRONT' }] };
vi.mock('./storage', () => ({
  isSharedStorageConfigured: () => true, toRowKey: (s: string) => s,
  getNamedTable: async () => ({ getEntity: async () => ({ payload: JSON.stringify({ id: 'sample_12345', totalBags: 48, photos: [{ id: 'photo_12345', role: 'FRONT' }] }) }) }),
  getNamedContainer: async () => ({ getBlockBlobClient: () => ({
    download: async () => {
      if (!storage.revision) throw { statusCode: 404 };
      return { etag: `"${storage.revision}"`, readableStreamBody: Readable.from([storage.payload]) };
    },
    uploadData: async (buffer: Buffer, options: any) => {
      const { ifMatch, ifNoneMatch } = options.conditions;
      if ((ifNoneMatch && storage.revision) || (ifMatch && ifMatch !== `"${storage.revision}"`)) throw { statusCode: 412 };
      storage.payload = buffer.toString(); storage.revision++;
      return { etag: `"${storage.revision}"` };
    },
  }) }),
}));
import { validateReview, trainingReview } from './trainingReview';
const review = () => ({ schemaVersion: 1, sampleId: sample.id, sourceTotal: 48, physicalPalletGroup: sample.id, status: 'unreviewed',
  reason: '', verifier: '', verificationMethod: '', faces: [{ photoId: 'photo_12345', role: 'FRONT', imageHash: 'a'.repeat(64),
    width: 100, height: 100, status: 'reviewed', reason: 'No visible flaps; face checked', verifier: 'Verifier A', humanCount: 0, boxes: [] }] });
const req = (method: string, body?: any, headers = {}) => new HttpRequest({ method, url: 'http://localhost/api/training/reviews/' + sample.id,
  params: { sampleId: sample.id }, headers, ...(body ? { body: { string: JSON.stringify(body) } } : {}) });
const ctx = { error: vi.fn() } as any;
describe('shared training reviews', () => {
  beforeEach(() => { storage.payload = ''; storage.revision = 0; });
  it('stores and reloads reviewed zero-count annotations without changing sample totals', async () => {
    const withoutVerifier = review(); withoutVerifier.faces[0].verifier = '';
    expect(validateReview(withoutVerifier, sample)).toBeNull();
    expect((await trainingReview(req('PUT', review(), { 'if-none-match': '*' }), ctx)).status).toBe(200);
    const result: any = await trainingReview(req('GET'), ctx);
    expect(result.jsonBody.review.faces[0].humanCount).toBe(0);
    expect(result.jsonBody.etag).toBe('"1"');
  });
  it('rejects a stale second session and a blind overwrite', async () => {
    await trainingReview(req('PUT', review(), { 'if-none-match': '*' }), ctx);
    expect((await trainingReview(req('PUT', review(), { 'if-match': '"1"' }), ctx)).status).toBe(200);
    expect((await trainingReview(req('PUT', review(), { 'if-match': '"1"' }), ctx)).status).toBe(409);
    expect((await trainingReview(req('PUT', review()), ctx)).status).toBe(428);
    expect(storage.revision).toBe(2);
  });
  it('rejects top photos, false review claims, and boxes outside the image', () => {
    let r: any = review(); r.faces[0].role = 'TOP'; expect(validateReview(r, sample)).not.toBeNull();
    r = review(); r.faces[0].humanCount = 1; expect(validateReview(r, sample)).not.toBeNull();
    r = review(); r.status = 'reviewed'; expect(validateReview(r, sample)).not.toBeNull();
    r = review(); r.faces[0].boxes = [{x:95,y:0,w:10,h:10,cls:0}]; r.faces[0].humanCount = 1;
    expect(validateReview(r, sample)).toBe('Box outside image');
    r = review(); r.sourceTotal = 60; expect(validateReview(r, sample)).toContain('recorded total changed');
    r = review(); r.faces = [null]; expect(validateReview(r, sample)).toBe('Invalid face annotation');
  });
});
