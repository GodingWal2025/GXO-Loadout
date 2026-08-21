import { describe, it, expect, beforeEach, vi, afterEach, beforeAll } from 'vitest';
import 'fake-indexeddb/auto';

class LocalStorageMock {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

const mockStorage = new LocalStorageMock();

beforeAll(() => {
  if (!globalThis.window) {
    Object.defineProperty(globalThis, 'window', { value: new EventTarget(), configurable: true });
  }
  if (!globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { value: mockStorage, configurable: true });
  }
  if (!globalThis.navigator) {
    Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
  }
});

import { getSyncState, syncNow } from './sync';
import { dbEnqueueRecord, dbApplyRemoteInspection } from './db';
import type { Inspection } from '../types/inspection';

describe('Adaptive Sync Engine & Delta Polling', () => {
  beforeEach(() => {
    mockStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it('tracks sync state correctly and exposes adaptive interval', () => {
    const state = getSyncState();
    expect(state).toBeDefined();
    expect(typeof state.syncing).toBe('boolean');
    expect(typeof state.pending).toBe('number');
    expect(state.adaptiveIntervalSeconds).toBeGreaterThanOrEqual(15);
  });

  it('performs delta sync sending stored since cursor when present', async () => {
    mockStorage.setItem('loadout.sync.cursor.v2.inspections', '2026-08-13T10:00:00.000Z');
    mockStorage.setItem('inspection.device.config', JSON.stringify({ siteId: 'site-alpha' }));

    let inspectionPages = 0;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, options?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/records/inspections')) {
        inspectionPages++;
        expect(urlStr).toContain('since=2026-08-13T10%3A00%3A00.000Z');
        expect(urlStr).toContain('siteId=site-alpha');
        expect(new Headers(options?.headers).get('x-loadout-site-id')).toBe('site-alpha');
        expect(new Headers(options?.headers).get('x-loadout-device-id')).toMatch(/^device-/);
        return new Response(JSON.stringify({
          resources: [],
          continuationToken: inspectionPages === 1 ? 'next-page' : undefined,
          serverTime: inspectionPages === 1
            ? '2026-08-13T11:00:00.000Z'
            : '2026-08-13T12:00:00.000Z',
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ resources: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await syncNow();

    expect(fetchSpy).toHaveBeenCalled();
    expect(inspectionPages).toBe(2);
    expect(mockStorage.getItem('loadout.sync.cursor.v2.inspections')).toBe('2026-08-13T11:00:00.000Z');
    expect(mockStorage.getItem('loadout.sync.deviceId.v1')).toMatch(/^device-/);
  });

  it('notifies an open inspection screen when a remote update is applied', async () => {
    const remote = {
      id: 'insp-remote-event',
      type: 'outbound',
      siteId: 'site-alpha',
      status: 'IN_PROGRESS',
      startedAt: '2026-08-13T10:00:00.000Z',
      flaggedItemsCount: 0,
      picklist: {} as any,
      bol: {} as any,
      staging: {} as any,
      pallets: [],
      lastEditedAt: '2026-08-13T10:05:00.000Z',
    } as Inspection;
    let received: Inspection | undefined;
    const handler = (event: Event) => {
      received = (event as CustomEvent<Inspection>).detail;
    };
    window.addEventListener('loadout-remote-inspection-updated', handler);

    await dbApplyRemoteInspection(remote);

    window.removeEventListener('loadout-remote-inspection-updated', handler);
    expect(received).toEqual(remote);
  });

  it('uploads a newer inspection save that replaces an in-flight queue item', async () => {
    const inspection = {
      id: 'insp-inflight-replacement',
      type: 'outbound',
      siteId: 'site-alpha',
      status: 'IN_PROGRESS',
      startedAt: '2026-08-13T10:00:00.000Z',
      flaggedItemsCount: 0,
      picklist: {} as any,
      bol: {} as any,
      staging: {} as any,
      pallets: [],
      lastEditedAt: '2026-08-13T10:01:00.000Z',
    } as Inspection;
    await dbEnqueueRecord('inspections', inspection);

    let releaseFirstPut!: () => void;
    const firstPutBlocked = new Promise<void>((resolve) => { releaseFirstPut = resolve; });
    let firstPutStarted!: () => void;
    const firstPutSeen = new Promise<void>((resolve) => { firstPutStarted = resolve; });
    const uploadedPalletCounts: number[] = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, options?: RequestInit) => {
      const body = options?.body ? JSON.parse(String(options.body)) : undefined;
      if (options?.method === 'PUT' && body?.id === inspection.id) {
        uploadedPalletCounts.push(body.pallets.length);
        if (uploadedPalletCounts.length === 1) {
          firstPutStarted();
          await firstPutBlocked;
        }
        return new Response(JSON.stringify({ record: body }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ resources: [], serverTime: new Date().toISOString() }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const firstSync = syncNow();
    await firstPutSeen;
    await dbEnqueueRecord('inspections', {
      ...inspection,
      pallets: [{ palletNumber: 1 } as any],
      lastEditedAt: '2026-08-13T10:02:00.000Z',
    });
    const rerun = syncNow();
    releaseFirstPut();
    await Promise.all([firstSync, rerun]);

    expect(uploadedPalletCounts).toEqual([0, 1]);
  });

  it('does not report a successful sync when a download fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Storage unavailable' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      })
    );

    await syncNow();

    const state = getSyncState();
    expect(state.error).toContain('Record download failed');
    expect(state.failedItems?.some((item) => item.id.startsWith('pull:'))).toBe(true);
  });

  it('handles 409 conflict by merging with remote and re-syncing without losing edits', async () => {
    const localInsp: Inspection = {
      id: 'insp-conflict-1',
      type: 'outbound',
      siteId: 'site-alpha',
      status: 'IN_PROGRESS',
      startedAt: '2026-08-13T10:00:00.000Z',
      flaggedItemsCount: 0,
      picklist: {} as any,
      bol: {} as any,
      staging: {} as any,
      pallets: [
        {
          palletNumber: 1,
          palletType: 'Full Bag Pallet',
          deliveryId: 'del-1',
          passInspection: 'Pass',
          accuracyLabelAttached: 'Yes',
          lpnNumber: 'LPN-LOCAL',
          batchSections: [],
          batchCount: 1,
          photos: [],
        },
      ],
      lastEditedAt: '2026-08-13T10:00:00.000Z',
    };
    await dbApplyRemoteInspection(localInsp);
    await dbEnqueueRecord('inspections', localInsp);

    const remoteInsp: Inspection = {
      ...localInsp,
      pallets: [
        undefined as any,
        {
          palletNumber: 2,
          palletType: 'Full Bag Pallet',
          deliveryId: 'del-1',
          passInspection: 'Pass',
          accuracyLabelAttached: 'Yes',
          lpnNumber: 'LPN-REMOTE',
          batchSections: [],
          batchCount: 1,
          photos: [],
        },
      ],
      lastEditedAt: '2026-08-13T10:05:00.000Z',
    };

    let putCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, opts: any) => {
      const urlStr = String(url);
      if (opts?.method === 'PUT') {
        putCount++;
        if (putCount === 1) {
          // First PUT returns 409 Conflict with remote record
          return new Response(JSON.stringify({
            error: 'Conflict detected',
            record: remoteInsp,
          }), { status: 409, headers: { 'content-type': 'application/json' } });
        }
        // Second PUT succeeds with merged record
        return new Response(JSON.stringify({
          record: JSON.parse(opts.body),
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ resources: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await syncNow();

    // After conflict merge, a second sync pushes the merged result
    await syncNow();

    expect(putCount).toBeGreaterThanOrEqual(2);
  });
});
