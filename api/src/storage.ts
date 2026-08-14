import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { TableClient, TableEntity } from '@azure/data-tables';
import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import { validateRecordSchema } from './validation';
import { validateMediaSignature, MAX_PHOTO_SIZE_BYTES } from './middleware/mediaValidation';
import { extractDeviceAuth, logAudit } from './middleware/auth';

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
  updatedAt: string;
  version: number;
  deleted: boolean;
  siteId?: string;
};

let tableReady: Promise<TableClient> | null = null;
let containerReady: Promise<ContainerClient> | null = null;

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
  const parsed = JSON.parse(entity.payload) as StoredRecord;
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
    const table = await getTable();
    let filter = `PartitionKey eq '${kind}'`;
    if (since) {
      // Escape single quotes for OData filter
      const safeSince = since.replace(/'/g, "''");
      filter += ` and updatedAt gt '${safeSince}'`;
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
        serverTime: new Date().toISOString(),
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
    if (Buffer.byteLength(payload, 'utf8') > 900_000) {
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

      // Optimistic concurrency check: if existing record is newer than incoming
      if (existingEntity.updatedAt > incomingUpdatedAt) {
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
      payload,
      updatedAt: incomingUpdatedAt,
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
