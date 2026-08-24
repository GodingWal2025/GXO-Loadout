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

type PicklistBatchLine = {
  batchCode?: { value?: string | null } | string;
  picklistException?: { reason?: string };
};

export function isPicklistExceptionLine(line: PicklistBatchLine | undefined): boolean {
  return line?.picklistException?.reason === 'not_on_original_picklist';
}

/**
 * True when a scanned batch was absent from the original picklist. A verifier
 * adding it as an exception must not make the warning disappear.
 */
export function isBatchNotOnOriginalPicklist(
  lineItems: PicklistBatchLine[] | undefined,
  batchCode: string | null | undefined
): boolean {
  const normalized = normalizeBatchCode(batchCode);
  if (!normalized || !lineItems?.length) return false;
  const matchingLine = lineItems.find(
    (line) => normalizeBatchCode(
      typeof line.batchCode === 'string' ? line.batchCode : line.batchCode?.value
    ) === normalized
  );
  return !matchingLine || isPicklistExceptionLine(matchingLine);
}
