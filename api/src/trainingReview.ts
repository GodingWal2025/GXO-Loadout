import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getNamedContainer, getNamedTable, isSharedStorageConfigured, toRowKey } from './storage';

const SIDES = ['FRONT', 'RIGHT', 'BACK', 'LEFT'];
const STATES = ['unreviewed', 'reviewed', 'unresolved', 'excluded'];
const ID = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_BYTES = 512 * 1024;

export function validateReview(body: any, sample: any): string | null {
  if (!body || body.schemaVersion !== 1 || body.sampleId !== sample.id) return 'Invalid review version or sample';
  if (body.sourceTotal !== sample.totalBags) return 'The recorded total changed; reload the pallet before reviewing';
  if (typeof body.physicalPalletGroup !== 'string' || !ID.test(body.physicalPalletGroup)) return 'Physical pallet group must be a sample ID or an 8–64 character identifier';
  if (!STATES.includes(body.status)) return 'Invalid review status';
  if (typeof body.reason !== 'string' || body.reason.length > 2000 || typeof body.verifier !== 'string' || body.verifier.length > 120 || typeof body.verificationMethod !== 'string' || body.verificationMethod.length > 500) return 'Invalid review details';
  if (body.status !== 'unreviewed' && !body.reason.trim()) return 'A review reason is required';
  if (body.status === 'reviewed' && !body.verificationMethod.trim()) return 'Record the physical count verification method';
  if (!Array.isArray(body.faces) || body.faces.length > 4) return 'Expected up to four side annotations';
  const seen = new Set();
  for (const face of body.faces) {
    if (!face || typeof face !== 'object') return 'Invalid face annotation';
    const source = sample.photos.find((p: any) => p.id === face.photoId && p.role === face.role);
    if (!source || !SIDES.includes(face.role) || seen.has(face.role)) return 'Unknown, duplicate, or non-side photo';
    seen.add(face.role);
    if (!/^[a-f0-9]{64}$/.test(face.imageHash)) return 'Image checksum required';
    if (!Number.isInteger(face.width) || !Number.isInteger(face.height) || face.width < 1 || face.height < 1 || face.width > 16000 || face.height > 16000) return 'Invalid image size';
    if (!STATES.includes(face.status) || typeof face.reason !== 'string' || face.reason.length > 2000 || typeof face.verifier !== 'string' || face.verifier.length > 120) return 'Invalid face review';
    if (face.status !== 'unreviewed' && !face.reason.trim()) return 'Face review requires a reason';
    if (!Array.isArray(face.boxes) || face.boxes.length > 1000) return 'Invalid boxes';
    if (face.status === 'reviewed' && (!Number.isInteger(face.humanCount) || face.humanCount !== face.boxes.length)) return 'Reviewed face count must match annotated boxes (zero is allowed)';
    for (const box of face.boxes) {
      if (!box || typeof box !== 'object') return 'Invalid box';
      if (box.cls !== 0 || ![box.x, box.y, box.w, box.h].every(Number.isFinite) || box.x < 0 || box.y < 0 || box.w <= 0 || box.h <= 0 || box.x + box.w > face.width || box.y + box.h > face.height) return 'Box outside image';
    }
  }
  return null;
}

export async function trainingReview(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (!isSharedStorageConfigured()) return { status: 501, jsonBody: { error: 'Training storage is not configured' } };
  const sampleId = String(request.params.sampleId || '');
  if (!ID.test(sampleId)) return { status: 400, jsonBody: { error: 'Invalid sample ID' } };
  try {
    const table = await getNamedTable((process.env.TRAINING_TABLE_NAME || 'TrainingSamples').trim());
    const entity = await table.getEntity<{ payload: string }>('sample', toRowKey(sampleId));
    const sample = JSON.parse(entity.payload);
    const container = await getNamedContainer('training-reviews');
    const blob = container.getBlockBlobClient(`${sampleId}.json`);
    if (request.method === 'GET') {
      try {
        const response = await blob.download();
        const chunks: Buffer[] = [];
        for await (const chunk of response.readableStreamBody!) chunks.push(Buffer.from(chunk));
        return { status: 200, jsonBody: { review: JSON.parse(Buffer.concat(chunks).toString('utf8')), etag: response.etag }, headers: { 'cache-control': 'no-store' } };
      } catch (error: any) {
        if (error.statusCode === 404) return { status: 200, jsonBody: { review: null, etag: null }, headers: { 'cache-control': 'no-store' } };
        throw error;
      }
    }
    const raw = await request.text();
    if (Buffer.byteLength(raw) > MAX_BYTES) return { status: 413, jsonBody: { error: 'Review is too large' } };
    let body: any;
    try { body = JSON.parse(raw); } catch { return { status: 400, jsonBody: { error: 'Invalid JSON' } }; }
    const error = validateReview(body, sample);
    if (error) return { status: 400, jsonBody: { error } };
    const etag = request.headers.get('if-match');
    // A caller must explicitly create or update its observed revision; never blind overwrite.
    if ((!etag || etag === '*') && request.headers.get('if-none-match') !== '*') return { status: 428, jsonBody: { error: 'Load the current review before saving' } };
    const review = { ...body, updatedAt: new Date().toISOString() };
    const response = await blob.uploadData(Buffer.from(JSON.stringify(review)), {
      conditions: etag && etag !== '*' ? { ifMatch: etag } : { ifNoneMatch: '*' },
      blobHTTPHeaders: { blobContentType: 'application/json' },
    });
    return { status: 200, jsonBody: { review, etag: response.etag } };
  } catch (error: any) {
    if ([409, 412].includes(error.statusCode)) return { status: 409, jsonBody: { error: 'Another session updated this review. Reload shared labels before merging your changes.' } };
    if (error.statusCode === 404) return { status: 404, jsonBody: { error: 'Sample not found' } };
    context.error('Training review storage error', error);
    return { status: 503, jsonBody: { error: 'Review storage is unavailable. Local labels are retained.' } };
  }
}

app.http('training-review', { methods: ['GET', 'PUT'], authLevel: 'anonymous', route: 'training/reviews/{sampleId}', handler: trainingReview });
