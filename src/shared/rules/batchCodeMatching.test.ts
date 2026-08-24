import { describe, expect, it } from 'vitest';
import {
  isBatchCodeValid,
  isBatchNotOnOriginalPicklist,
  isPicklistExceptionLine,
  normalizeBatchCode,
} from './batchCodeMatching';

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

  it('keeps an added exception identifiable after it becomes a picklist line', () => {
    const lines = [{
      batchCode: { value: 'BATCH-EXTRA' },
      picklistException: {
        reason: 'not_on_original_picklist' as const,
        addedAt: '2026-08-24T12:00:00.000Z',
      },
    }];

    expect(isPicklistExceptionLine(lines[0])).toBe(true);
    expect(isBatchNotOnOriginalPicklist(lines, 'batch-extra')).toBe(true);
  });

  it('distinguishes original, missing, and empty batch codes', () => {
    const lines = [{ batchCode: { value: 'ORIGINAL-1' } }];

    expect(isBatchNotOnOriginalPicklist(lines, 'original-1')).toBe(false);
    expect(isBatchNotOnOriginalPicklist(lines, 'MISSING-2')).toBe(true);
    expect(isBatchNotOnOriginalPicklist(lines, '')).toBe(false);
  });
});
