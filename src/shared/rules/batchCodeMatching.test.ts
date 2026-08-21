import { describe, expect, it } from 'vitest';
import { isBatchCodeValid, normalizeBatchCode } from './batchCodeMatching';

describe('batch code matching', () => {
  it('ignores case and visible or invisible Unicode spacing', () => {
    expect(isBatchCodeValid(' P18\u00a0GP43N8 ', 'p18\u200bgp43n8')).toBe(true);
  });

  it('normalizes full-width OCR characters', () => {
    expect(normalizeBatchCode('Ｐ１８ＧＰ４３Ｎ８')).toBe('P18GP43N8');
  });

  it('does not silently equate ambiguous letters and digits', () => {
    expect(isBatchCodeValid('BATCHO1', 'BATCH01')).toBe(false);
    expect(isBatchCodeValid('BATCHI1', 'BATCH11')).toBe(false);
  });
});
