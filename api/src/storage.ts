import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { TableClient, TableEntity } from '@azure/data-tables';
import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';

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

type StoredRecord = Record<string, unknown> & { id: string };
type RecordEntity = TableEntity & {
  recordId: string;
  payload: string;
  updatedAt: string;
  deleted: boolean;
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

// Other modules (training data collection) need their own table + container on
// the same storage account. These share the connection-string resolution above
// so there is exactly one place that decides which account we talk to.
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

async function getTable(): Promise<TableClient> {
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

async function getPhotoContainer(): Promise<ContainerClient> {
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
  const value = kind === 'inspections'
    ? record.lastEditedAt || record.completedAt || record.startedAt
    : kind === 'inventory'
      ? record.lastUpdated
      : record.updatedAt || record.createdAt;
  return typeof value === 'string' && value ? value : new Date().toISOString();
}

function parseEntity(entity: RecordEntity): StoredRecord {
  return JSON.parse(entity.payload) as StoredRecord;
}

function validateKind(request: HttpRequest): string | null {
  const kind = String(request.params.kind || '').toLowerCase();
  return allowedKinds.has(kind) ? kind : null;
}

async function listRecords(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const kind = validateKind(request);
  if (!kind) return { status: 404, jsonBody: { error: 'Unknown record type' } };

  try {
    const table = await getTable();
    const records: StoredRecord[] = [];
    for await (const entity of table.listEntities<RecordEntity>({
      queryOptions: { filter: `PartitionKey eq '${kind}'` },
    })) {
      records.push(parseEntity(entity));
    }
    return { status: 200, jsonBody: { resources: records } };
  } catch (error) {
    context.error('Unable to list shared records', error);
    return { status: 503, jsonBody: { error: 'Shared storage is unavailable' } };
  }
}

async function putRecord(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const kind = validateKind(request);
  const id = decodeURIComponent(String(request.params.id || ''));
  if (!kind || !id) return { status: 404, jsonBody: { error: 'Unknown record' } };

  try {
    const record = (await request.json()) as StoredRecord;
    if (!record || typeof record !== 'object' || record.id !== id) {
      return { status: 400, jsonBody: { error: 'Body id must match the route id' } };
    }

    const payload = JSON.stringify(record);
    if (Buffer.byteLength(payload, 'utf8') > 900_000) {
      return { status: 413, jsonBody: { error: 'Record is too large' } };
    }

    const table = await getTable();
    const rowKey = safeRowKey(id);
    const incomingUpdatedAt = recordTimestamp(kind, record);
    try {
      const existing = await table.getEntity<RecordEntity>(kind, rowKey);
      if (existing.updatedAt > incomingUpdatedAt) {
        return { status: 409, jsonBody: { record: parseEntity(existing) } };
      }
    } catch (error: any) {
      if (error?.statusCode !== 404) throw error;
    }

    const entity: RecordEntity = {
      partitionKey: kind,
      rowKey,
      recordId: id,
      payload,
      updatedAt: incomingUpdatedAt,
      deleted: record.deleted === true,
    };
    await table.upsertEntity(entity, 'Replace');
    return { status: 200, jsonBody: { record } };
  } catch (error) {
    context.error('Unable to save shared record', error);
    return { status: 503, jsonBody: { error: 'Shared storage is unavailable' } };
  }
}

async function photos(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const photoId = String(request.params.photoId || '');
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(photoId)) {
    return { status: 400, jsonBody: { error: 'Invalid photo id' } };
  }

  try {
    const container = await getPhotoContainer();
    const blob = container.getBlockBlobClient(`${photoId}.jpg`);
    if (request.method === 'POST') {
      const bytes = Buffer.from(await request.arrayBuffer());
      if (!bytes.length || bytes.length > 8 * 1024 * 1024) {
        return { status: 413, jsonBody: { error: 'Photo must be between 1 byte and 8 MB' } };
      }
      await blob.uploadData(bytes, {
        blobHTTPHeaders: { blobContentType: request.headers.get('content-type') || 'image/jpeg' },
      });
      return { status: 201, jsonBody: { url: `/api/photos/${encodeURIComponent(photoId)}` } };
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
