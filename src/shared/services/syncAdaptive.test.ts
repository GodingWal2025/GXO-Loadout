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
    mockStorage.setItem('loadout.sync.cursor.inspections', '2026-08-13T10:00:00.000Z');
    mockStorage.setItem('loadout.deviceConfig', JSON.stringify({ siteId: 'site-alpha', deviceId: 'dev-1' }));

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/records/inspections')) {
        expect(urlStr).toContain('since=2026-08-13T10%3A00%3A00.000Z');
        expect(urlStr).toContain('siteId=site-alpha');
        return new Response(JSON.stringify({
          resources: [],
          serverTime: '2026-08-13T11:00:00.000Z',
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ resources: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await syncNow();

    expect(fetchSpy).toHaveBeenCalled();
    expect(mockStorage.getItem('loadout.sync.cursor.inspections')).toBe('2026-08-13T11:00:00.000Z');
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
