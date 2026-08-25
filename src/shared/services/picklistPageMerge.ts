import type { PicklistLineItemEntry, Suggestable } from '../types/inspection';

function value<T>(field: Suggestable<T> | undefined): T | null {
  return field?.value ?? null;
}

function sameOrMissing<T>(left: T | null, right: T | null): boolean {
  return left === null || right === null || left === right;
}

function choose<T>(left: Suggestable<T>, right: Suggestable<T>): Suggestable<T> {
  return value(left) !== null ? left : right;
}

function mergeDescription(
  left: Suggestable<string>,
  right: Suggestable<string>
): Suggestable<string> {
  const a = value(left)?.trim() || '';
  const b = value(right)?.trim() || '';
  if (!a) return right;
  if (!b || a === b) return left;
  return { ...left, value: `${a} ${b}` };
}

function isExactRepeat(left: PicklistLineItemEntry, right: PicklistLineItemEntry): boolean {
  return (
    value(left.batchCode) === value(right.batchCode) &&
    value(left.sku) === value(right.sku) &&
    value(left.description) === value(right.description) &&
    value(left.expectedQuantity) === value(right.expectedQuantity) &&
    left.uom === right.uom
  );
}

function canJoinSplitRow(left: PicklistLineItemEntry, right: PicklistLineItemEntry): boolean {
  const leftBatch = value(left.batchCode);
  const rightBatch = value(right.batchCode);
  const leftSku = value(left.sku);
  const rightSku = value(right.sku);
  const leftQty = value(left.expectedQuantity);
  const rightQty = value(right.expectedQuantity);

  if (!sameOrMissing(leftBatch, rightBatch) || !sameOrMissing(leftSku, rightSku)) return false;
  if (!sameOrMissing(leftQty, rightQty)) return false;
  if (left.deliveryId && right.deliveryId && left.deliveryId !== right.deliveryId) return false;

  // The joined row must have both an identity and a quantity. Requiring each
  // half to contribute a missing core value prevents adjacent valid rows from
  // being combined merely because one optional field is blank.
  const unionHasIdentity = Boolean(leftBatch || rightBatch || leftSku || rightSku);
  const unionHasQuantity = leftQty !== null || rightQty !== null;
  const leftContributes =
    (leftBatch !== null && rightBatch === null) ||
    (leftSku !== null && rightSku === null) ||
    (leftQty !== null && rightQty === null);
  const rightContributes =
    (rightBatch !== null && leftBatch === null) ||
    (rightSku !== null && leftSku === null) ||
    (rightQty !== null && leftQty === null);
  return unionHasIdentity && unionHasQuantity && leftContributes && rightContributes;
}

/**
 * Reconcile the last OCR row from one photographed page with the first row of
 * the next page. SAP can print one logical line across the physical page break;
 * Azure then returns two complementary incomplete rows. Exact repeated boundary
 * rows are also de-duplicated.
 */
export function reconcilePicklistPageBoundary(
  existing: PicklistLineItemEntry[],
  incoming: PicklistLineItemEntry[]
): { existing: PicklistLineItemEntry[]; incoming: PicklistLineItemEntry[]; changed: boolean } {
  if (!existing.length || !incoming.length) return { existing, incoming, changed: false };

  const left = existing[existing.length - 1];
  const right = incoming[0];
  if (isExactRepeat(left, right)) {
    return { existing, incoming: incoming.slice(1), changed: true };
  }
  if (!canJoinSplitRow(left, right)) return { existing, incoming, changed: false };

  const merged: PicklistLineItemEntry = {
    ...left,
    batchCode: choose(left.batchCode, right.batchCode),
    sku: choose(left.sku, right.sku),
    description: mergeDescription(left.description, right.description),
    expectedQuantity: choose(left.expectedQuantity, right.expectedQuantity),
    uom: left.uom !== 'BG' || right.uom === 'BG' ? left.uom : right.uom,
    deliveryId: left.deliveryId || right.deliveryId,
  };

  return {
    existing: existing.slice(0, -1),
    incoming: [merged, ...incoming.slice(1)],
    changed: true,
  };
}
