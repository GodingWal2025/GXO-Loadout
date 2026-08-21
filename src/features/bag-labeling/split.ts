import type { DatasetSplit } from './types';

export const DATASET_SPLIT_SALT = 'gxo-pallet-v1';

export async function splitForPalletGroup(
  palletGroupId: string,
  salt = DATASET_SPLIT_SALT
): Promise<DatasetSplit> {
  const bytes = new TextEncoder().encode(`${palletGroupId}::${salt}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  // Reading four bytes is stable across JS engines and stays below Number's
  // integer precision limit. The bucket is deterministic in every client.
  const bucket = new DataView(digest.buffer).getUint32(0, false) % 100;
  if (bucket < 70) return 'train';
  if (bucket < 85) return 'valid';
  return 'test';
}
