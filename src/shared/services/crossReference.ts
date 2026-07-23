// Cross-reference the picklist against the BOL.
//
// The BOL carries no batch code — SAP only stamps batches onto it after the
// load is picked — so the two documents are matched on SKU. Multiple picklist
// batches can share one SKU, so quantities are summed per SKU before comparing.
// "The total quantity for a SKU should match" (per the floor's rule).

import type {
  Inspection,
  CrossReferenceResult,
  LineItemDiscrepancy,
} from '../types/inspection';

/** Normalize a SKU for matching: trim, uppercase, drop surrounding whitespace. */
function normSku(raw: string | null | undefined): string {
  return (raw || '').trim().toUpperCase();
}

/** Normalize a free-text header value for equality (case/space-insensitive). */
function normHeader(raw: string | null | undefined): string {
  return (raw || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

interface SkuTotal {
  sku: string;
  description: string | null;
  qty: number;
}

/** Sum a set of {sku, description, qty} rows into per-SKU totals. */
function sumBySku(
  rows: Array<{ sku: string | null; description: string | null; qty: number | null }>
): Map<string, SkuTotal> {
  const totals = new Map<string, SkuTotal>();
  for (const row of rows) {
    const sku = normSku(row.sku);
    if (!sku) continue; // a row with no SKU can't be matched — skip it
    const existing = totals.get(sku);
    const qty = row.qty ?? 0;
    if (existing) {
      existing.qty += qty;
      if (!existing.description && row.description) existing.description = row.description;
    } else {
      totals.set(sku, { sku, description: row.description ?? null, qty });
    }
  }
  return totals;
}

/**
 * Compare the picklist and BOL line items on the given inspection and return a
 * structured result. Pure function — the caller persists it via SET_CROSS_REFERENCE.
 */
export function computeCrossReference(inspection: Inspection): CrossReferenceResult {
  const picklistTotals = sumBySku(
    inspection.picklist.lineItems.map((li) => ({
      sku: li.sku.value,
      description: li.description.value,
      qty: li.expectedQuantity.value,
    }))
  );
  const bolTotals = sumBySku(
    (inspection.bol.lineItems ?? []).map((li) => ({
      sku: li.sku.value,
      description: li.description.value,
      qty: li.quantity.value,
    }))
  );

  const discrepancies: LineItemDiscrepancy[] = [];
  const allSkus = new Set<string>([...picklistTotals.keys(), ...bolTotals.keys()]);

  for (const sku of allSkus) {
    const pick = picklistTotals.get(sku);
    const bol = bolTotals.get(sku);
    const description = pick?.description ?? bol?.description ?? undefined;

    if (pick && !bol) {
      discrepancies.push({ sku, description, picklistQty: pick.qty, kind: 'missing-on-bol' });
    } else if (!pick && bol) {
      discrepancies.push({ sku, description, bolQty: bol.qty, kind: 'missing-on-picklist' });
    } else if (pick && bol && pick.qty !== bol.qty) {
      discrepancies.push({
        sku,
        description,
        picklistQty: pick.qty,
        bolQty: bol.qty,
        kind: 'qty-mismatch',
      });
    }
  }

  // Sort for stable display: mismatches first, then by SKU.
  const order: Record<LineItemDiscrepancy['kind'], number> = {
    'qty-mismatch': 0,
    'missing-on-bol': 1,
    'missing-on-picklist': 2,
  };
  discrepancies.sort((a, b) => order[a.kind] - order[b.kind] || a.sku.localeCompare(b.sku));

  // Header fields only flag a mismatch when BOTH sides carry a value — a blank
  // on one side means "not captured", not "different".
  const pickLoad = normHeader(inspection.picklist.loadNumber.value);
  const bolLoad = normHeader(inspection.bol.loadNumber.value);
  const loadNumberMatches = !pickLoad || !bolLoad ? true : pickLoad === bolLoad;

  const pickDate = normHeader(inspection.picklist.shipDate.value);
  const bolDate = normHeader(inspection.bol.shipDate.value);
  const shipDateMatches = !pickDate || !bolDate ? true : pickDate === bolDate;

  return {
    loadNumberMatches,
    shipDateMatches,
    lineItemDiscrepancies: discrepancies,
    matches: loadNumberMatches && shipDateMatches && discrepancies.length === 0,
    computedAt: new Date().toISOString(),
  };
}
