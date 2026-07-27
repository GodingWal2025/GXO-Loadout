// Client wrapper for the server-side pallet bag-count assist. A self-hosted
// NVIDIA Cosmos3 Reasoner NIM runs on a GPU host behind the Function, so its
// URL/key never reach the browser. The model reasons about the visible stack
// (layers + anomalies) rather than counting individual bags; the caller
// multiplies layers by the known bags-per-layer and the verifier confirms.

const apiBase = import.meta.env.VITE_API_URL || '';

export interface PalletCountResult {
  success: boolean;
  /** Number of stacked layers the model saw (drives layers × bags-per-layer). */
  layers: number | null;
  topLayerFull: boolean;
  gaps: boolean;
  damage: boolean;
  /** The model's own whole-pallet-face guess; a fallback when layers is unusable. */
  estimatedBags: number | null;
  confidence: number | null;
  rationale: string | null;
  modelVersion?: string;
}

/**
 * Send a pallet-face photo to the vision endpoint. Throws on network error /
 * non-2xx (including 501 "not configured" when COSMOS_NIM_URL is unset) so the
 * caller can fall back to the manual layer entry.
 */
export async function analyzePalletCount(blob: Blob): Promise<PalletCountResult> {
  const res = await fetch(`${apiBase}/api/analyze-pallet-count`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: blob,
  });
  if (!res.ok) {
    throw new Error(`analyze-pallet-count failed: ${res.status}`);
  }
  return (await res.json()) as PalletCountResult;
}
