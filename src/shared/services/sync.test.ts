import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getDB,
  dbEnqueueSync,
  dbGetPendingSync,
  dbRequeueStalledSync,
  dbResetFailedSync,
  dbReenqueueOrphanedPhotos,
  dbUpdateSyncEntry,
  MAX_SYNC_ATTEMPTS,
} from './db';
import { processSyncQueue, forceFullSync, setApiUrl } from './sync';

// Reset the persisted stores between tests (the db module memoizes a single
// connection, so we clear rather than recreate the database).
beforeEach(async () => {
  const db = await getDB();
  await db.clear('syncQueue');
  await db.clear('inspections');
  await db.clear('photoBlobs');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function markStatus(inspectionId: string, status: string, attempts = 1) {
  const pending = await dbGetPendingSync();
  const e = pending.find((p) => p.inspectionId === inspectionId)!;
  e.status = status as any;
  e.attempts = attempts;
  await dbUpdateSyncEntry(e);
}

describe('sync queue recovery (dbRequeueStalledSync)', () => {
  it('reproduces the bug: a failed entry is invisible to the queue', async () => {
    await dbEnqueueSync({ type: 'inspection-save', inspectionId: 'insp-1' });
    await markStatus('insp-1', 'failed', 1);

    // This is the original bug: the queue only ever looked at 'pending', so a
    // failed push was stranded forever.
    expect(await dbGetPendingSync()).toHaveLength(0);
  });

  it('re-queues a failed entry (below the attempts cap) back to pending', async () => {
    await dbEnqueueSync({ type: 'inspection-save', inspectionId: 'insp-1' });
    await markStatus('insp-1', 'failed', 1);

    const requeued = await dbRequeueStalledSync();
    expect(requeued).toBe(1);

    const pending = await dbGetPendingSync();
    expect(pending).toHaveLength(1);
    expect(pending[0].inspectionId).toBe('insp-1');
  });

  it('re-queues an orphaned in-progress entry (tab closed mid-sync)', async () => {
    await dbEnqueueSync({ type: 'inspection-save', inspectionId: 'insp-2' });
    await markStatus('insp-2', 'in-progress', 0);
    expect(await dbGetPendingSync()).toHaveLength(0);

    await dbRequeueStalledSync();
    expect(await dbGetPendingSync()).toHaveLength(1);
  });

  it('leaves a permanently-failed entry (>= MAX_SYNC_ATTEMPTS) stranded', async () => {
    await dbEnqueueSync({ type: 'inspection-save', inspectionId: 'insp-3' });
    await markStatus('insp-3', 'failed', MAX_SYNC_ATTEMPTS);

    const requeued = await dbRequeueStalledSync();
    expect(requeued).toBe(0);
    expect(await dbGetPendingSync()).toHaveLength(0);
  });
});

describe('manual refresh (forceFullSync)', () => {
  it('revives an entry the automatic loop gave up on', async () => {
    await dbEnqueueSync({ type: 'inspection-save', inspectionId: 'insp-dead' });
    await markStatus('insp-dead', 'failed', MAX_SYNC_ATTEMPTS);

    // The automatic loop leaves it stranded...
    expect(await dbRequeueStalledSync()).toBe(0);

    // ...but an explicit refresh resets the counter and retries it.
    expect(await dbResetFailedSync()).toBe(1);
    const pending = await dbGetPendingSync();
    expect(pending).toHaveLength(1);
    expect(pending[0].attempts).toBe(0);
  });

  it('re-enqueues an un-uploaded photo that lost its queue entry', async () => {
    const db = await getDB();
    await db.put('photoBlobs', {
      photoId: 'photo-orphan',
      inspectionId: 'insp-5',
      blob: new Blob(['x']),
      capturedAt: '2026-07-15T00:00:00.000Z',
      uploaded: false,
    } as any);
    // An already-uploaded blob must not be re-queued.
    await db.put('photoBlobs', {
      photoId: 'photo-done',
      inspectionId: 'insp-5',
      blob: new Blob(['y']),
      capturedAt: '2026-07-15T00:00:00.000Z',
      uploaded: true,
    } as any);

    expect(await dbReenqueueOrphanedPhotos()).toBe(1);
    const pending = await dbGetPendingSync();
    expect(pending).toHaveLength(1);
    expect(pending[0].photoId).toBe('photo-orphan');

    // Idempotent: a second pass sees the entry it just created.
    expect(await dbReenqueueOrphanedPhotos()).toBe(0);
  });

  it('rejects when the server is unreachable so the UI can report it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Load failed'); }));
    setApiUrl('');
    await expect(forceFullSync()).rejects.toThrow();
  });

  it('pulls cloud inspections and drains the queue in one pass', async () => {
    const db = await getDB();
    await db.put('inspections', {
      id: 'insp-6', siteId: 'S1', status: 'IN_PROGRESS', lastEditedAt: '2026-07-15T00:00:00.000Z',
    } as any);
    await dbEnqueueSync({ type: 'inspection-save', inspectionId: 'insp-6' });
    await markStatus('insp-6', 'failed', MAX_SYNC_ATTEMPTS);

    vi.stubGlobal('fetch', vi.fn(async (url: any) => ({
      ok: true,
      status: 200,
      json: async () =>
        String(url).includes('/api/inspections')
          ? { resources: [{ id: 'insp-cloud', siteId: 'S1', status: 'COMPLETED', lastEditedAt: '2026-07-20T00:00:00.000Z' }] }
          : { success: true },
    } as any)));

    // Tests run in node, so the UI-nudge events have nowhere to go.
    vi.stubGlobal('window', { dispatchEvent: vi.fn() });

    setApiUrl('');
    const result = await forceFullSync();

    expect(result.pulled).toBe(1);
    expect(result.revived).toBe(1);
    expect(result.stillPending).toBe(0);
    expect(await db.get('inspections', 'insp-cloud')).toBeTruthy();
    expect(await db.getAll('syncQueue')).toHaveLength(0);
  });
});

describe('processSyncQueue end-to-end', () => {
  it('pushes a previously-failed inspection once the API is reachable again', async () => {
    // Seed the stranded-backlog scenario: an inspection exists locally, but its
    // sync entry was marked failed while the backend was down.
    const db = await getDB();
    await db.put('inspections', {
      id: 'insp-4',
      siteId: 'S1',
      status: 'IN_PROGRESS',
      lastEditedAt: '2026-07-15T00:00:00.000Z',
    } as any);
    await dbEnqueueSync({ type: 'inspection-save', inspectionId: 'insp-4' });
    await markStatus('insp-4', 'failed', 1);

    // Environment: online, server reachable, POST succeeds.
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: any, opts: any) => {
      calls.push(`${opts?.method ?? 'GET'} ${url}`);
      return { ok: true, status: 200, json: async () => ({ success: true }) } as any;
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('navigator', { onLine: true });

    setApiUrl('');
    await processSyncQueue();

    // The failed entry was resurrected and pushed to the sync endpoint.
    expect(calls).toContain('POST /api/sync-inspection');

    // Queue fully drained (completed entries are deleted).
    expect(await dbGetPendingSync()).toHaveLength(0);
    expect(await db.getAll('syncQueue')).toHaveLength(0);
  });

  it('does NOT burn a retry attempt on a connectivity failure (offline)', async () => {
    const db = await getDB();
    await db.put('inspections', { id: 'insp-net', siteId: 'S', status: 'IN_PROGRESS', lastEditedAt: '2026-07-15T00:00:00.000Z' } as any);
    await dbEnqueueSync({ type: 'inspection-save', inspectionId: 'insp-net' });

    // fetch rejects with TypeError, exactly how the browser signals offline.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Load failed'); }));
    vi.stubGlobal('navigator', { onLine: true });

    setApiUrl('');
    await processSyncQueue();

    const entry = (await db.getAll('syncQueue')).find((e) => e.inspectionId === 'insp-net')!;
    expect(entry.status).toBe('failed');
    expect(entry.attempts).toBe(0); // connectivity failure must not count toward the cap
  });

  it('DOES burn a retry attempt on a server rejection', async () => {
    const db = await getDB();
    await db.put('inspections', { id: 'insp-srv', siteId: 'S', status: 'IN_PROGRESS', lastEditedAt: '2026-07-15T00:00:00.000Z' } as any);
    await dbEnqueueSync({ type: 'inspection-save', inspectionId: 'insp-srv' });

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) } as any)));
    vi.stubGlobal('navigator', { onLine: true });

    setApiUrl('');
    await processSyncQueue();

    const entry = (await db.getAll('syncQueue')).find((e) => e.inspectionId === 'insp-srv')!;
    expect(entry.status).toBe('failed');
    expect(entry.attempts).toBe(1); // server rejection counts toward the cap
  });
});
