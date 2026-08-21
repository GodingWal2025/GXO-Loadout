import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { TableClient, TableEntity } from '@azure/data-tables';
import {
  BlobSASPermissions,
  BlobServiceClient,
  ContainerClient,
  SASProtocol,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
} from '@azure/storage-blob';
import { validateRecordSchema } from './validation';
import { validateMediaSignature, MAX_PHOTO_SIZE_BYTES } from './middleware/mediaValidation';
import { extractDeviceAuth, logAudit } from './middleware/auth';
import { randomUUID, timingSafeEqual } from 'node:crypto';

const legacyStorageAccountName = (process.env.STORAGE_ACCOUNT_NAME || '').trim().toLowerCase();
const legacyStorageAccountKey = (process.env.STORAGE_ACCOUNT_KEY || '').trim();
const legacyConnectionString = /^[a-z0-9]{3,24}$/.test(legacyStorageAccountName) && legacyStorageAccountKey
  ? `DefaultEndpointsProtocol=https;AccountName=${legacyStorageAccountName};AccountKey=${legacyStorageAccountKey};EndpointSuffix=core.windows.net`
  : '';
const connectionString = (
  process.env.LOADOUT_STORAGE_CONNECTION_STRING ||
  legacyConnectionString ||
  process.env.AzureWebJobsStorage ||
  ''
).trim();
const tableName = (process.env.LOADOUT_TABLE_NAME || 'LoadoutRecords').trim();
const photoContainerName = (process.env.LOADOUT_PHOTO_CONTAINER || 'loadout-photos').trim();
const datasetContainerName = (process.env.LOADOUT_DATASET_CONTAINER || 'loadout-datasets').trim();
const visionAdminKey = (process.env.VISION_ADMIN_KEY || '').trim();
const allowedKinds = new Set(['inspections', 'inventory', 'sites', 'inspectors', 'staging']);

export type StoredRecord = Record<string, unknown> & {
  id: string;
  siteId?: string;
  _rev?: number;
  deleted?: boolean;
};

export type RecordEntity = TableEntity & {
  recordId: string;
  payload: string;
  payloadChunkCount?: number;
  recordUpdatedAt?: string;
  updatedAt: string;
  version: number;
  deleted: boolean;
  siteId?: string;
};

// Azure Table Storage limits each UTF-16 string property to 64 KiB (roughly
// 32K characters). Keep chunks comfortably below that limit and reserve room
// in the 1 MiB entity limit for keys, timestamps, and other properties.
export const RECORD_PAYLOAD_CHUNK_CHARACTERS = 24_000;
export const MAX_RECORD_PAYLOAD_UTF16_BYTES = 768 * 1024;

type RecordPayloadProperties = Record<string, string | number> & {
  payload: string;
  payloadChunkCount: number;
};

export function encodeRecordPayload(payload: string): RecordPayloadProperties {
  const properties = {} as RecordPayloadProperties;
  const chunks: string[] = [];

  for (let offset = 0; offset < payload.length;) {
    let end = Math.min(offset + RECORD_PAYLOAD_CHUNK_CHARACTERS, payload.length);
    // Do not split an emoji or other supplementary character's surrogate pair.
    if (
      end < payload.length &&
      end > offset &&
      payload.charCodeAt(end - 1) >= 0xd800 &&
      payload.charCodeAt(end - 1) <= 0xdbff &&
      payload.charCodeAt(end) >= 0xdc00 &&
      payload.charCodeAt(end) <= 0xdfff
    ) {
      end -= 1;
    }
    chunks.push(payload.slice(offset, end));
    offset = end;
  }

  if (chunks.length === 0) chunks.push('');
  properties.payload = chunks[0];
  properties.payloadChunkCount = chunks.length;
  for (let index = 1; index < chunks.length; index += 1) {
    properties[`payload${index}`] = chunks[index];
  }
  return properties;
}

export function decodeRecordPayload(entity: Pick<RecordEntity, 'payload' | 'payloadChunkCount'> & Record<string, unknown>): string {
  const chunkCount = entity.payloadChunkCount ?? 1;
  if (!Number.isInteger(chunkCount) || chunkCount < 1) {
    throw new Error('Stored record has an invalid payload chunk count');
  }

  let payload = entity.payload;
  for (let index = 1; index < chunkCount; index += 1) {
    const chunk = entity[`payload${index}`];
    if (typeof chunk !== 'string') {
      throw new Error(`Stored record is missing payload chunk ${index}`);
    }
    payload += chunk;
  }
  return payload;
}

let tableReady: Promise<TableClient> | null = null;
let containerReady: Promise<ContainerClient> | null = null;
let datasetContainerReady: Promise<ContainerClient> | null = null;

export function isSharedStorageConfigured(): boolean {
  return Boolean(connectionString);
}

export async function probeSharedStorage(): Promise<{ configured: boolean; available: boolean }> {
  if (!isSharedStorageConfigured()) return { configured: false, available: false };
  try {
    await Promise.all([getTable(), getPhotoContainer()]);
    return { configured: true, available: true };
  } catch {
    return { configured: true, available: false };
  }
}

function requireConnectionString(): string {
  if (!connectionString) throw new Error('LOADOUT_STORAGE_CONNECTION_STRING is not configured');
  return connectionString;
}

const namedTables = new Map<string, Promise<TableClient>>();
const namedContainers = new Map<string, Promise<ContainerClient>>();

export async function getNamedTable(name: string): Promise<TableClient> {
  let ready = namedTables.get(name);
  if (!ready) {
    ready = (async () => {
      const client = TableClient.fromConnectionString(requireConnectionString(), name);
      await client.createTable();
      return client;
    })().catch((error) => {
      namedTables.delete(name);
      throw error;
    });
    namedTables.set(name, ready);
  }
  return ready;
}

export async function getNamedContainer(name: string): Promise<ContainerClient> {
  let ready = namedContainers.get(name);
  if (!ready) {
    ready = (async () => {
      const service = BlobServiceClient.fromConnectionString(requireConnectionString());
      const container = service.getContainerClient(name);
      await container.createIfNotExists();
      return container;
    })().catch((error) => {
      namedContainers.delete(name);
      throw error;
    });
    namedContainers.set(name, ready);
  }
  return ready;
}

export function toRowKey(id: string): string {
  return Buffer.from(id, 'utf8').toString('base64url');
}

export async function getTable(): Promise<TableClient> {
  if (!tableReady) {
    tableReady = (async () => {
      const client = TableClient.fromConnectionString(requireConnectionString(), tableName);
      await client.createTable();
      return client;
    })().catch((error) => {
      tableReady = null;
      throw error;
    });
  }
  return tableReady;
}

export async function getPhotoContainer(): Promise<ContainerClient> {
  if (!containerReady) {
    containerReady = (async () => {
      const service = BlobServiceClient.fromConnectionString(requireConnectionString());
      const container = service.getContainerClient(photoContainerName);
      await container.createIfNotExists();
      return container;
    })().catch((error) => {
      containerReady = null;
      throw error;
    });
  }
  return containerReady;
}

async function getDatasetContainer(): Promise<ContainerClient> {
  if (!datasetContainerReady) {
    datasetContainerReady = (async () => {
      const service = BlobServiceClient.fromConnectionString(requireConnectionString());
      const container = service.getContainerClient(datasetContainerName);
      await container.createIfNotExists();
      return container;
    })().catch((error) => {
      datasetContainerReady = null;
      throw error;
    });
  }
  return datasetContainerReady;
}

function hasAdminRole(request: HttpRequest): boolean {
  const principal = request.headers.get('x-ms-client-principal');
  if (principal) {
    try {
      const decoded = JSON.parse(Buffer.from(principal, 'base64').toString('utf8')) as { userRoles?: string[] };
      if (decoded.userRoles?.some((role) => role === 'admin' || role === 'vision-admin')) return true;
    } catch {
      return false;
    }
  }
  const provided = request.headers.get('x-admin-key') || '';
  if (visionAdminKey && provided && Buffer.byteLength(provided) === Buffer.byteLength(visionAdminKey)) {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(visionAdminKey));
  }
  return process.env.ALLOW_INSECURE_VISION_ADMIN === 'true';
}

function datasetSharedKey(): { accountName: string; credential: StorageSharedKeyCredential } | null {
  if (!legacyStorageAccountName || !legacyStorageAccountKey) return null;
  return {
    accountName: legacyStorageAccountName,
    credential: new StorageSharedKeyCredential(legacyStorageAccountName, legacyStorageAccountKey),
  };
}

async function createDatasetSas(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (!hasAdminRole(request)) return { status: 401, jsonBody: { error: 'Vision admin authentication required' } };
  const key = datasetSharedKey();
  if (!key) {
    return { status: 501, jsonBody: { error: 'Dataset SAS requires STORAGE_ACCOUNT_NAME and STORAGE_ACCOUNT_KEY' } };
  }
  try {
    const body = await request.json() as { size?: number; sha256?: string; contentType?: string };
    const size = Number(body?.size);
    const sha256 = String(body?.sha256 || '').toLowerCase();
    if (!Number.isFinite(size) || size <= 0 || size > 2 * 1024 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(sha256)) {
      return { status: 400, jsonBody: { error: 'Invalid dataset size or SHA-256' } };
    }
    const container = await getDatasetContainer();
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z');
    const blobName = `v${stamp}/${randomUUID()}.zip`;
    const expiresOn = new Date(Date.now() + 15 * 60_000);
    const sas = generateBlobSASQueryParameters({
      containerName: datasetContainerName,
      blobName,
      permissions: BlobSASPermissions.parse('cw'),
      startsOn: new Date(Date.now() - 60_000),
      expiresOn,
      contentType: body.contentType || 'application/zip',
      protocol: SASProtocol.Https,
    }, key.credential).toString();
    const uploadUrl = `${container.getBlockBlobClient(blobName).url}?${sas}`;
    return { status: 200, jsonBody: { uploadUrl, blobName, expiresAt: expiresOn.toISOString() } };
  } catch (error) {
    context.error('Unable to create dataset SAS', error);
    return { status: 503, jsonBody: { error: 'Dataset upload service unavailable' } };
  }
}

async function finalizeDataset(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (!hasAdminRole(request)) return { status: 401, jsonBody: { error: 'Vision admin authentication required' } };
  try {
    const body = await request.json() as { blobName?: string; size?: number; sha256?: string };
    const blobName = String(body?.blobName || '');
    const size = Number(body?.size);
    const sha256 = String(body?.sha256 || '').toLowerCase();
    if (!/^v\d{8}T\d{6}Z\/[a-f0-9-]+\.zip$/.test(blobName) || !/^[a-f0-9]{64}$/.test(sha256)) {
      return { status: 400, jsonBody: { error: 'Invalid dataset finalization payload' } };
    }
    const blob = (await getDatasetContainer()).getBlockBlobClient(blobName);
    const properties = await blob.getProperties();
    if (properties.contentLength !== size || properties.metadata?.sha256 !== sha256) {
      return { status: 409, jsonBody: { error: 'Uploaded dataset size or digest metadata does not match' } };
    }
    await blob.setTags({ state: 'ready', sha256, finalizedAt: new Date().toISOString() });
    return { status: 200, jsonBody: { blobName, size, sha256, state: 'ready' } };
  } catch (error: any) {
    if (error?.statusCode === 404) return { status: 404, jsonBody: { error: 'Dataset upload not found' } };
    context.error('Unable to finalize dataset', error);
    return { status: 503, jsonBody: { error: 'Dataset finalization failed' } };
  }
}

function safeRowKey(id: string): string {
  return Buffer.from(id, 'utf8').toString('base64url');
}

function recordTimestamp(kind: string, record: StoredRecord): string {
  const value =
    kind === 'inspections'
      ? record.lastEditedAt || record.completedAt || record.startedAt
      : kind === 'inventory'
        ? record.lastUpdated
        : record.updatedAt || record.createdAt;
  return typeof value === 'string' && value ? value : new Date().toISOString();
}

function parseEntity(entity: RecordEntity): StoredRecord {
  const parsed = JSON.parse(decodeRecordPayload(entity)) as StoredRecord;
  parsed._rev = typeof entity.version === 'number' ? entity.version : 1;
  if (entity.deleted) {
    parsed.deleted = true;
  }
  return parsed;
}

function validateKind(request: HttpRequest): string | null {
  const kind = String(request.params.kind || '').toLowerCase();
  return allowedKinds.has(kind) ? kind : null;
}

export async function listRecords(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const kind = validateKind(request);
  if (!kind) return { status: 404, jsonBody: { error: 'Unknown record type' } };

  const since = request.query.get('since') || request.query.get('updatedSince');
  const siteId = request.query.get('siteId');
  const continuationToken = request.query.get('continuationToken') || undefined;
  const limitParam = parseInt(request.query.get('limit') || '500', 10);
  const limit = isNaN(limitParam) ? 500 : Math.min(500, Math.max(1, limitParam));

  try {
    // Use the query start as the delta watermark. A write arriving while this
    // page is being read will then be included in the next poll, not skipped.
    const syncWatermark = new Date().toISOString();
    const table = await getTable();
    let filter = `PartitionKey eq '${kind}'`;
    if (since) {
      // Escape single quotes for OData filter
      const safeSince = since.replace(/'/g, "''");
      filter += ` and updatedAt ge '${safeSince}'`;
    }

    const records: StoredRecord[] = [];
    let nextContinuationToken: string | undefined = undefined;

    const iterator = table
      .listEntities<RecordEntity>({ queryOptions: { filter } })
      .byPage({ maxPageSize: limit, continuationToken });

    for await (const page of iterator) {
      for (const entity of page) {
        const record = parseEntity(entity);
        if (!siteId || !record.siteId || record.siteId === siteId) {
          records.push(record);
        }
      }
      nextContinuationToken = page.continuationToken;
      // Return single page per request to respect pagination
      break;
    }

    return {
      status: 200,
      jsonBody: {
        resources: records,
        continuationToken: nextContinuationToken,
        serverTime: syncWatermark,
      },
    };
  } catch (error) {
    context.error('Unable to list shared records', error);
    return { status: 503, jsonBody: { error: 'Shared storage is unavailable' } };
  }
}

export async function putRecord(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const kind = validateKind(request);
  const id = decodeURIComponent(String(request.params.id || ''));
  if (!kind || !id) return { status: 404, jsonBody: { error: 'Unknown record' } };

  const auth = extractDeviceAuth(request);

  try {
    const record = (await request.json()) as StoredRecord;
    if (!record || typeof record !== 'object' || record.id !== id) {
      return { status: 400, jsonBody: { error: 'Body id must match the route id' } };
    }

    // Schema Validation
    const validation = validateRecordSchema(kind, record);
    if (!validation.valid) {
      logAudit(context, 'PUT_RECORD_VALIDATION_FAILED', {
        deviceId: auth.deviceId,
        siteId: auth.siteId,
        kind,
        recordId: id,
        status: 400,
        error: JSON.stringify(validation.errors),
      });
      return {
        status: 400,
        jsonBody: { error: 'Validation failed', details: validation.errors },
      };
    }

    const payload = JSON.stringify(record);
    if (Buffer.byteLength(payload, 'utf16le') > MAX_RECORD_PAYLOAD_UTF16_BYTES) {
      return { status: 413, jsonBody: { error: 'Record is too large' } };
    }

    const table = await getTable();
    const rowKey = safeRowKey(id);
    const incomingUpdatedAt = recordTimestamp(kind, record);

    let existingEntity: RecordEntity | null = null;
    try {
      existingEntity = await table.getEntity<RecordEntity>(kind, rowKey);
    } catch (error: any) {
      if (error?.statusCode !== 404) throw error;
    }

    let nextVersion = 1;
    if (existingEntity) {
      nextVersion = (existingEntity.version || 0) + 1;

      // Compare business-record timestamps for conflict handling. `updatedAt`
      // is server receipt time and is reserved for reliable delta polling.
      const existingRecordUpdatedAt = existingEntity.recordUpdatedAt || existingEntity.updatedAt;
      if (existingRecordUpdatedAt > incomingUpdatedAt) {
        logAudit(context, 'PUT_RECORD_CONFLICT', {
          deviceId: auth.deviceId,
          siteId: auth.siteId,
          kind,
          recordId: id,
          status: 409,
        });
        return {
          status: 409,
          jsonBody: {
            error: 'Conflict detected',
            record: parseEntity(existingEntity),
            serverRevision: existingEntity.version || 1,
            etag: existingEntity.etag,
          },
        };
      }
    }

    const entity: RecordEntity = {
      partitionKey: kind,
      rowKey,
      recordId: id,
      ...encodeRecordPayload(payload),
      recordUpdatedAt: incomingUpdatedAt,
      updatedAt: new Date().toISOString(),
      version: nextVersion,
      deleted: record.deleted === true,
      siteId: typeof record.siteId === 'string' ? record.siteId : undefined,
    };

    await table.upsertEntity(entity, 'Replace');

    logAudit(context, 'PUT_RECORD_SUCCESS', {
      deviceId: auth.deviceId,
      siteId: auth.siteId,
      kind,
      recordId: id,
      status: 200,
    });

    return {
      status: 200,
      jsonBody: {
        record: { ...record, _rev: nextVersion },
        serverTime: new Date().toISOString(),
      },
    };
  } catch (error) {
    context.error('Unable to save shared record', error);
    return { status: 503, jsonBody: { error: 'Shared storage is unavailable' } };
  }
}

export async function photos(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const photoId = String(request.params.photoId || '');
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(photoId)) {
    return { status: 400, jsonBody: { error: 'Invalid photo id' } };
  }

  const auth = extractDeviceAuth(request);

  try {
    const container = await getPhotoContainer();
    const blob = container.getBlockBlobClient(`${photoId}.jpg`);

    if (request.method === 'POST') {
      const bytes = Buffer.from(await request.arrayBuffer());
      if (!bytes.length) {
        return { status: 400, jsonBody: { error: 'Empty photo payload' } };
      }
      if (bytes.length > MAX_PHOTO_SIZE_BYTES) {
        return { status: 413, jsonBody: { error: 'Photo exceeds 8 MB limit' } };
      }

      // Validate magic bytes
      const validation = validateMediaSignature(bytes, ['image/jpeg', 'image/png', 'image/webp']);
      if (!validation.valid) {
        logAudit(context, 'PHOTO_UPLOAD_INVALID_SIGNATURE', {
          deviceId: auth.deviceId,
          recordId: photoId,
          status: 415,
          error: validation.error,
        });
        return { status: 415, jsonBody: { error: validation.error || 'Invalid image signature' } };
      }

      const contentType = validation.mediaType || 'image/jpeg';
      await blob.uploadData(bytes, {
        blobHTTPHeaders: { blobContentType: contentType },
      });

      logAudit(context, 'PHOTO_UPLOAD_SUCCESS', {
        deviceId: auth.deviceId,
        recordId: photoId,
        status: 201,
      });

      return { status: 201, jsonBody: { url: `/api/photos/${encodeURIComponent(photoId)}` } };
    }

    const download = await blob.download();
    const bytes = await blob.downloadToBuffer();
    const safeContentType = download.contentType || 'image/jpeg';

    return {
      status: 200,
      body: bytes,
      headers: {
        'content-type': safeContentType,
        'cache-control': 'private, max-age=86400',
        'x-content-type-options': 'nosniff',
      },
    };
  } catch (error: any) {
    if (error?.statusCode === 404) return { status: 404, jsonBody: { error: 'Photo not found' } };
    context.error('Unable to access shared photo', error);
    return { status: 503, jsonBody: { error: 'Shared photo storage is unavailable' } };
  }
}

app.http('shared-record-list', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'records/{kind}',
  handler: listRecords,
});

app.http('shared-record-put', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'records/{kind}/{id}',
  handler: putRecord,
});

app.http('shared-photos', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'photos/{photoId}',
  handler: photos,
});

app.http('dataset-upload-sas', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'datasets/sas',
  handler: createDatasetSas,
});

app.http('dataset-upload-finalize', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'datasets/finalize',
  handler: finalizeDataset,
});
