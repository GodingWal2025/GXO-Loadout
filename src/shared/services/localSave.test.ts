import { describe, expect, it, vi } from 'vitest';
import { getLocalSaveState, retryLocalSaves, trackLocalSave } from './localSave';

describe('local save visibility', () => {
  it('reports pending until the storage transaction finishes', async () => {
    let finish!: () => void;
    const save = trackLocalSave('pending-test', () => new Promise<void>(resolve => { finish = resolve; }));
    expect(getLocalSaveState().pending).toBe(1);
    finish(); await save;
    expect(getLocalSaveState()).toEqual({ pending: 0, failed: 0 });
  });
  it('keeps failed writes available for explicit retry', async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error('Quota exceeded')).mockResolvedValue(undefined);
    await expect(trackLocalSave('retry-test', write)).rejects.toThrow('Quota exceeded');
    expect(getLocalSaveState().failed).toBe(1);
    await retryLocalSaves();
    expect(write).toHaveBeenCalledTimes(2);
    expect(getLocalSaveState()).toEqual({ pending: 0, failed: 0 });
  });
  it('does not let an older failure replace the latest successful write', async () => {
    let fail!: (error: Error) => void;
    const old = trackLocalSave('same-record', () => new Promise<void>((_resolve, reject) => { fail = reject; }));
    const caught = old.catch(() => {});
    await trackLocalSave('same-record', async () => {});
    fail(new Error('Old request')); await caught;
    expect(getLocalSaveState()).toEqual({ pending: 0, failed: 0 });
  });
});
