import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { TableEntity } from '@azure/data-tables';
import { getNamedContainer, getNamedTable, isSharedStorageConfigured, toRowKey } from './storage';

/**
 * Training-data collection.
 *
 * Several people photograph pallets in the aisle from the bag-count console's
 * Collect tab. Each submission is one *sample*: four side photos of a single
 * pallet, one to three close-ups of a bag flap (batch code + material
 * description), and the human ground-truth count.
 *
 * Photos land in blob storage, the counts land in table storage, and
 * `detector-service/sync_training_data.py` pulls both down into
 * `detector-service/dataset/raw/` so they can be committed to the repo and
 * labeled. Nothing here writes to git — the repo owner decides what gets
 * committed.
 */

const TABLE = (process.env.TRAINING_TABLE_NAME || 'TrainingSamples').trim();
const CONTAINER = (process.env.TRAINING_PHOTO_CONTAINER || 'training-photos').trim();
const PARTITION = 'sample';

/** Four sides first, then up to three flap close-ups. Legacy top-view uploads remain
 * accepted so existing samples can still be reviewed or edited. Order matters: the
 * console requires all four sides before it will let a sample be submitted. */
export const SIDE_ROLES = ['FRONT', 'RIGHT', 'BACK', 'LEFT'] as const;
export const FLAP_ROLES = ['FLAP_1', 'FLAP_2', 'FLAP_3'] as const;
export const TOP_ROLES = ['TOP'] as const;
const ALL_ROLES = new Set<string>([...SIDE_ROLES, ...FLAP_ROLES, ...TOP_ROLES]);

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024;

type PhotoRef = {
  id: string;
  role: string;
  width?: number;
  height?: number;
  bytes?: number;
};

type TrainingSample = {
  id: string;
  /** Empty unless a caller supplies one — the console no longer asks. */
  palletId: string;
  site: string;
  /** Anonymous per-device tag from the console, or 'unknown'. */
  collector: string;
  /** 'good' (bag counting model) vs 'bad' (bad picture / anomaly model) */
  quality?: 'good' | 'bad';
  batchCode: string | null;
  materialDescription: string | null;
  sku: string | null;
  /** Bags in one complete layer (course) of the pallet. */
  bagsPerLayer: number;
  /** Number of complete layers stacked. */
  fullLayers: number;
  /** Bags in the incomplete top layer, 0 when the top course is full. */
  partialBags: number;
  /** What the collector counted by hand. Should equal
   *  bagsPerLayer * fullLayers + partialBags; the console warns when it does not. */
  totalBags: number;
  notes: string | null;
  photos: PhotoRef[];
  capturedAt: string;
  submittedAt: string;
};

type SampleEntity = TableEntity & { sampleId: string; payload: string; updatedAt: string };

function unavailable(context: InvocationContext, message: string, error: unknown): HttpResponseInit {
  context.error(message, error);
  return { status: 503, jsonBody: { error: 'Training storage is unavailable' } };
}

function notConfigured(): HttpResponseInit {
  return {
    status: 501,
    jsonBody: {
      error: 'Training storage is not configured',
      detail: 'Set LOADOUT_STORAGE_CONNECTION_STRING in the Static Web App application settings.',
    },
  };
}

function num(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100000 ? Math.round(n) : null;
}

function str(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** Rejects anything the sync script or the trainer would choke on later. */
function validateSample(id: string, body: any): { sample: TrainingSample } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Body must be a JSON object' };
  if (body.id !== id) return { error: 'Body id must match the route id' };

  // palletId, site, and collector are all optional: the console stopped asking
  // for them so that a collector can go straight from photo to count without
  // typing. Submissions are identified by their sample id, and the console sends
  // an anonymous per-device tag as the collector so batches stay separable.
  const bagsPerLayer = num(body.bagsPerLayer);
  const fullLayers = num(body.fullLayers);
  const partialBags = num(body.partialBags);
  const totalBags = num(body.totalBags);
  if (bagsPerLayer === null || bagsPerLayer < 1) return { error: 'bagsPerLayer must be 1 or more' };
  if (fullLayers === null || fullLayers < 1) return { error: 'fullLayers must be 1 or more' };
  if (partialBags === null) return { error: 'partialBags must be 0 or more' };
  if (totalBags === null || totalBags < 1) return { error: 'totalBags must be 1 or more' };

  const photos = Array.isArray(body.photos) ? body.photos : [];
  const seenRoles = new Set<string>();
  const cleaned: PhotoRef[] = [];
  for (const photo of photos) {
    const photoId = typeof photo?.id === 'string' ? photo.id : '';
    const role = typeof photo?.role === 'string' ? photo.role.toUpperCase() : '';
    if (!ID_RE.test(photoId)) return { error: `Invalid photo id "${photoId}"` };
    if (!ALL_ROLES.has(role)) return { error: `Unknown photo role "${role}"` };
    if (seenRoles.has(role)) return { error: `Duplicate photo role "${role}"` };
    seenRoles.add(role);
    cleaned.push({
      id: photoId,
      role,
      width: num(photo.width) ?? undefined,
      height: num(photo.height) ?? undefined,
      bytes: num(photo.bytes) ?? undefined,
    });
  }

  const missingSides = SIDE_ROLES.filter((role) => !seenRoles.has(role));
  if (missingSides.length) {
    return { error: `Missing required side photo(s): ${missingSides.join(', ')}` };
  }
  if (!FLAP_ROLES.some((role) => seenRoles.has(role))) {
    return { error: 'At least one bag-flap photo is required' };
  }

  const quality: 'good' | 'bad' = body.quality === 'bad' ? 'bad' : 'good';

  return {
    sample: {
      id,
      palletId: str(body.palletId, 64) || '',
      site: str(body.site, 64) || 'unspecified',
      collector: str(body.collector, 64) || 'unknown',
      quality,
      batchCode: str(body.batchCode, 64),
      materialDescription: str(body.materialDescription, 256),
      sku: str(body.sku, 64),
      bagsPerLayer,
      fullLayers,
      partialBags,
      totalBags,
      notes: str(body.notes, 512),
      photos: cleaned,
      capturedAt: str(body.capturedAt, 40) || new Date().toISOString(),
      submittedAt: new Date().toISOString(),
    },
  };
}

/**
 * PUT /api/training/samples/{sampleId} — save the manifest.
 *
 * Photos are uploaded first, so a manifest that references a photo id is a
 * promise the bytes are already in the container. Re-PUTting the same id
 * overwrites, which is how the console retries a failed submission without
 * creating duplicates.
 */
async function putSample(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (!isSharedStorageConfigured()) return notConfigured();
  const id = String(request.params.sampleId || '');
  if (!ID_RE.test(id)) return { status: 400, jsonBody: { error: 'Invalid sample id' } };

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { status: 400, jsonBody: { error: 'Body must be valid JSON' } };
  }

  const result = validateSample(id, body);
  if ('error' in result) return { status: 400, jsonBody: { error: result.error } };

  const payload = JSON.stringify(result.sample);
  if (Buffer.byteLength(payload, 'utf8') > MAX_MANIFEST_BYTES) {
    return { status: 413, jsonBody: { error: 'Sample manifest is too large' } };
  }

  try {
    const table = await getNamedTable(TABLE);
    const entity: SampleEntity = {
      partitionKey: PARTITION,
      rowKey: toRowKey(id),
      sampleId: id,
      payload,
      updatedAt: result.sample.submittedAt,
    };
    await table.upsertEntity(entity, 'Replace');
    return { status: 200, jsonBody: { sample: result.sample } };
  } catch (error) {
    return unavailable(context, 'Unable to save training sample', error);
  }
}

/** GET /api/training/samples — every manifest, newest first. Feeds the sync script. */
async function listSamples(_request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (!isSharedStorageConfigured()) return notConfigured();
  try {
    const table = await getNamedTable(TABLE);
    const samples: TrainingSample[] = [];
    for await (const entity of table.listEntities<SampleEntity>({
      queryOptions: { filter: `PartitionKey eq '${PARTITION}'` },
    })) {
      try {
        samples.push(JSON.parse(entity.payload) as TrainingSample);
      } catch {
        context.warn(`Skipping unreadable training sample ${entity.sampleId}`);
      }
    }
    samples.sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
    const photoCount = samples.reduce((sum, s) => sum + s.photos.length, 0);
    return { status: 200, jsonBody: { samples, count: samples.length, photoCount } };
  } catch (error) {
    return unavailable(context, 'Unable to list training samples', error);
  }
}

/** DELETE /api/training/samples/{sampleId} — drop a bad submission and its photos. */
async function deleteSample(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (!isSharedStorageConfigured()) return notConfigured();
  const id = String(request.params.sampleId || '');
  if (!ID_RE.test(id)) return { status: 400, jsonBody: { error: 'Invalid sample id' } };

  try {
    const table = await getNamedTable(TABLE);
    const rowKey = toRowKey(id);
    let sample: TrainingSample | null = null;
    try {
      const existing = await table.getEntity<SampleEntity>(PARTITION, rowKey);
      sample = JSON.parse(existing.payload) as TrainingSample;
    } catch (error: any) {
      if (error?.statusCode !== 404) throw error;
      return { status: 404, jsonBody: { error: 'Sample not found' } };
    }

    const container = await getNamedContainer(CONTAINER);
    await Promise.all(
      sample.photos.map((photo) =>
        container.getBlockBlobClient(blobName(id, photo.id)).deleteIfExists()
      )
    );
    await table.deleteEntity(PARTITION, rowKey);
    return { status: 200, jsonBody: { deleted: id, photos: sample.photos.length } };
  } catch (error) {
    return unavailable(context, 'Unable to delete training sample', error);
  }
}

function blobName(sampleId: string, photoId: string): string {
  return `${sampleId}/${photoId}.jpg`;
}

/**
 * POST/GET /api/training/photos/{sampleId}/{photoId}
 *
 * One photo per request rather than a multipart bundle: a phone on warehouse
 * wifi drops connections, and a failed single photo is cheap to retry.
 */
async function photo(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (!isSharedStorageConfigured()) return notConfigured();
  const sampleId = String(request.params.sampleId || '');
  const photoId = String(request.params.photoId || '');
  if (!ID_RE.test(sampleId) || !ID_RE.test(photoId)) {
    return { status: 400, jsonBody: { error: 'Invalid sample or photo id' } };
  }

  try {
    const container = await getNamedContainer(CONTAINER);
    const blob = container.getBlockBlobClient(blobName(sampleId, photoId));

    if (request.method === 'POST') {
      const bytes = Buffer.from(await request.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) {
        return { status: 413, jsonBody: { error: 'Photo must be between 1 byte and 8 MB' } };
      }
      const role = String(request.headers.get('x-photo-role') || '').toUpperCase();
      await blob.uploadData(bytes, {
        blobHTTPHeaders: { blobContentType: 'image/jpeg' },
        metadata: ALL_ROLES.has(role) ? { role, sampleId } : { sampleId },
      });
      return {
        status: 201,
        jsonBody: {
          url: `/api/training/photos/${encodeURIComponent(sampleId)}/${encodeURIComponent(photoId)}`,
          bytes: bytes.length,
        },
      };
    }

    const download = await blob.download();
    const bytes = await blob.downloadToBuffer();
    return {
      status: 200,
      body: bytes,
      headers: {
        'content-type': download.contentType || 'image/jpeg',
        'cache-control': 'private, max-age=86400',
      },
    };
  } catch (error: any) {
    if (error?.statusCode === 404) return { status: 404, jsonBody: { error: 'Photo not found' } };
    return unavailable(context, 'Unable to access training photo', error);
  }
}

app.http('training-sample-list', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'training/samples',
  handler: listSamples,
});

app.http('training-sample-put', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'training/samples/{sampleId}',
  handler: putSample,
});

app.http('training-sample-delete', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'training/samples/{sampleId}',
  handler: deleteSample,
});

app.http('training-photo', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'training/photos/{sampleId}/{photoId}',
  handler: photo,
});
