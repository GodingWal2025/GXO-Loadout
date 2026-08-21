import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestPersistentAppStorage } from './storagePersistence';

describe('persistent PWA storage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('requests persistence when storage is not already persistent', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('navigator', {
      storage: {
        persisted: vi.fn().mockResolvedValue(false),
        persist,
      },
    });

    await expect(requestPersistentAppStorage()).resolves.toBe(true);
    expect(persist).toHaveBeenCalledOnce();
  });

  it('degrades safely when the browser does not expose the API', async () => {
    vi.stubGlobal('navigator', {});
    await expect(requestPersistentAppStorage()).resolves.toBeUndefined();
  });
});
