// Client wrapper for the server-side OCR endpoint (Azure AI Document
// Intelligence runs in the Function, so the API key never reaches the browser).
// The verifier confirms/corrects every extracted value, so results are
// best-effort — callers must degrade gracefully to manual entry on failure.

const apiBase = import.meta.env.VITE_API_URL || '';

export interface OcrLineItem {
  batchCode: string | null;
  /** Material / SKU number, e.g. "91007244". */
  sku: string | null;
  /** Material description, e.g. "C.CL.201-40VT4PRIB.SF2.40USP.UB.US". */
  description: string | null;
  expectedQuantity: number | null;
  uom: 'BAG' | 'SP' | 'PCE';
}

/**
 * Send a picklist photo to the analyze endpoint and get back extracted line
 * items. Throws on network error / non-2xx (including 501 "not configured") so
 * the caller can fall back to manual entry.
 */
export async function analyzePicklistPhoto(blob: Blob): Promise<OcrLineItem[]> {
  const res = await fetch(`${apiBase}/api/analyze-picklist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: blob,
  });
  if (!res.ok) {
    throw new Error(`analyze-picklist failed: ${res.status}`);
  }
  const json = (await res.json()) as { lineItems?: OcrLineItem[] };
  return json.lineItems ?? [];
}

/** A BOL line item read by OCR. No batch code — SAP adds batches after picking. */
export interface BolOcrLineItem {
  sku: string | null;
  description: string | null;
  quantity: number | null;
  uom: 'BAG' | 'SP' | 'PCE';
  shipmentNumber: string | null;
  deliveryNumber: string | null;
  stopNumber: number | null;
}

export interface BolOcrHeader {
  loadNumber: string | null;
  shipDate: string | null;
  shipmentNumber: string | null;
}

export interface BolOcrResult {
  lineItems: BolOcrLineItem[];
  header: BolOcrHeader;
}

/**
 * Send a BOL photo to the analyze endpoint and get back extracted line items
 * plus header fields. Throws on network error / non-2xx so the caller can fall
 * back to manual entry.
 */
export async function analyzeBolPhoto(blob: Blob): Promise<BolOcrResult> {
  const res = await fetch(`${apiBase}/api/analyze-bol`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: blob,
  });
  if (!res.ok) {
    throw new Error(`analyze-bol failed: ${res.status}`);
  }
  const json = (await res.json()) as Partial<BolOcrResult>;
  return {
    lineItems: json.lineItems ?? [],
    header: json.header ?? { loadNumber: null, shipDate: null, shipmentNumber: null },
  };
}
