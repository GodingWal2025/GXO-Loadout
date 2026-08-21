/**
 * Canonical form used whenever a picklist batch is compared with a pallet.
 * OCR can introduce full-width characters, non-breaking spaces, or invisible
 * Unicode separators. Those should not make a visibly identical code appear
 * "unlisted". Deliberately do not collapse ambiguous characters such as O/0.
 */
export function normalizeBatchCode(value: string | null | undefined): string {
  return (value || '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[\s\u200B-\u200D\u2060\uFEFF]+/g, '');
}

export const isBatchCodeValid = (expectedCode: string, scannedCode: string): boolean => {
  const expected = normalizeBatchCode(expectedCode);
  const scanned = normalizeBatchCode(scannedCode);
  return Boolean(expected && scanned && expected === scanned);
};
