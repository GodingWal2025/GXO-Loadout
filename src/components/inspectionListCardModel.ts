import type { Inspection, PicklistLineItemEntry } from '../shared/types/inspection';
import { isPackagingLine } from '../shared/types/inspection';
import { isBatchNotOnOriginalPicklist } from '../shared/rules/batchCodeMatching';
import { expectedBags } from '../shared/rules/uomRules';

interface CardProductLine {
  id: string;
  batchCode: string;
  actualQuantity: number;
  expectedQuantity: number;
  fulfilled: boolean;
}

interface CardInboundLine {
  id: string;
  batch: string;
  qtyReceived: number;
  qtyDamaged: number;
  uom: string;
}

export interface InspectionListCardModel {
  productLines: CardProductLine[];
  totalExpected: number;
  totalActual: number;
  percentComplete: number;
  hasUnlistedBatch: boolean;
  inboundLines: CardInboundLine[];
  inboundReceived: number;
  inboundDamaged: number;
  loadNumber: string;
}

export type InspectionCardStatus = 'complete' | 'incomplete' | 'issue';

export function getInspectionCardStatus(
  inspection: Inspection,
  card: InspectionListCardModel,
  flaggedItemsCount: number
): InspectionCardStatus {
  const isFinished = inspection.status === 'COMPLETED' || inspection.status === 'FLAGGED';
  const finishedQuantityMismatch = Boolean(
    isFinished &&
    inspection.type === 'outbound' &&
    card.totalExpected > 0 &&
    card.totalActual !== card.totalExpected
  );
  const crossReferenceMismatch = Boolean(
    inspection.crossReference && inspection.crossReference.matches === false
  );
  const hasIssue = Boolean(
    inspection.status === 'FLAGGED' ||
    flaggedItemsCount > 0 ||
    card.hasUnlistedBatch ||
    card.inboundDamaged > 0 ||
    crossReferenceMismatch ||
    finishedQuantityMismatch
  );

  if (hasIssue) return 'issue';
  return isFinished ? 'complete' : 'incomplete';
}

function valueOf<T>(field: unknown): T | undefined {
  if (field == null) return undefined;
  if (typeof field === 'object' && 'value' in field) {
    return ((field as { value?: T | null }).value ?? undefined) as T | undefined;
  }
  return field as T;
}

function finiteNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

/**
 * Normalize persisted inspection data before rendering the home-page card.
 * Older rows can predate required Suggestable fields, so rendering must not
 * trust the current TypeScript interface as a runtime schema.
 */
export function buildInspectionListCardModel(inspection: Inspection): InspectionListCardModel {
  const picklist = inspection.picklist as Inspection['picklist'] | undefined;
  const rawProductLines = Array.isArray(picklist?.lineItems) ? picklist.lineItems : [];
  const hasOcr = rawProductLines.some(
    (line) => line.sku?.source === 'ml' || line.batchCode?.source === 'ml'
  );
  const includedLines = inspection.type === 'outbound' && hasOcr
    ? rawProductLines.filter((line) => !isPackagingLine(line))
    : rawProductLines;

  const productLines = includedLines.map((line, index): CardProductLine => {
    const legacy = line as PicklistLineItemEntry & Record<string, unknown>;
    const description = valueOf<string>(legacy.description) ?? valueOf<string>(legacy.productName) ?? '';
    const expected = expectedBags(
      typeof legacy.uom === 'string' ? legacy.uom : '',
      finiteNumber(valueOf(legacy.expectedQuantity)),
      description,
    );
    return {
      id: typeof legacy.id === 'string' ? legacy.id : `legacy-line-${index}`,
      batchCode: valueOf<string>(legacy.batchCode) ?? '',
      actualQuantity: finiteNumber(legacy.actualQuantity),
      expectedQuantity: expected,
      fulfilled: Boolean(legacy.fulfilled),
    };
  });

  const totalExpected = productLines.reduce((sum, line) => sum + line.expectedQuantity, 0);
  const totalActual = productLines.reduce((sum, line) => sum + line.actualQuantity, 0);
  const percentComplete = totalExpected > 0 ? Math.round((totalActual / totalExpected) * 100) : 0;
  const pallets = Array.isArray(inspection.pallets) ? inspection.pallets : [];
  const hasUnlistedBatch = pallets.some((pallet) =>
    (Array.isArray(pallet?.batchSections) ? pallet.batchSections : []).some((section) => {
      return isBatchNotOnOriginalPicklist(
        rawProductLines,
        valueOf<string>(section?.batchCode)
      );
    })
  );

  const rawInboundLines = Array.isArray(inspection.inbound?.lineItems)
    ? inspection.inbound.lineItems
    : [];
  const inboundLines = rawInboundLines.map((line, index): CardInboundLine => ({
    id: typeof line?.id === 'string' ? line.id : `legacy-inbound-${index}`,
    batch: valueOf<string>(line?.batch) ?? '',
    qtyReceived: finiteNumber(valueOf(line?.qtyReceived)),
    qtyDamaged: finiteNumber(valueOf(line?.qtyDamaged)),
    uom: typeof line?.uom === 'string' ? line.uom : '',
  }));

  const loadNumber =
    valueOf<string>(inspection.inbound?.bolNumber) ||
    valueOf<string>(picklist?.loadNumber) ||
    valueOf<string>(inspection.bol?.loadNumber) ||
    valueOf<string>(inspection.returnsBol?.bolNumber) ||
    String(inspection.id || '').slice(0, 8) ||
    'Unknown';

  return {
    productLines,
    totalExpected,
    totalActual,
    percentComplete,
    hasUnlistedBatch,
    inboundLines,
    inboundReceived: inboundLines.reduce((sum, line) => sum + line.qtyReceived, 0),
    inboundDamaged: inboundLines.reduce((sum, line) => sum + line.qtyDamaged, 0),
    loadNumber,
  };
}
