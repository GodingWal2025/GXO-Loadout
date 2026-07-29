// Client wrapper for the server-side pallet bag-count assist. The vision model
// runs behind the Function so its URL/key never reach the browser. The model
// reasons about the visible stack (layers + anomalies) rather than counting
// individual bags; the caller multiplies layers by the known bags-per-layer and
// the verifier confirms.

import {
  decoderAlreadyRotated,
  orientationTransform,
  readJpegInfo,
} from './jpegOrientation';

const apiBase = import.meta.env.VITE_API_URL || '';

/** Long edge the pallet face is downscaled to before upload. */
const MAX_EDGE = 1024;

/**
 * Ceiling on the JPEG bytes we upload.
 *
 * The Function base64-encodes the body into a data URI for the model, and
 * NVIDIA-hosted endpoints reject inline images beyond ~180KB of base64. Base64
 * inflates by 4/3, so the raw JPEG has to stay under ~135KB; 128KB leaves room
 * for the data-URI prefix. Straight-from-camera photos are ~2.5MB, so this
 * downscale is required for the hosted path to work at all — not an optimization.
 * It also keeps the round trip inside the 45s Static Web Apps gateway timeout.
 */
const MAX_UPLOAD_BYTES = 128 * 1024;

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

/** Scale a frame to fit inside `maxEdge` on its longest side, preserving aspect. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge || longest === 0) return { width, height };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Re-encode a camera photo small enough for the vision endpoint to accept.
 *
 * Returns the original blob unchanged if the browser can't decode or draw it —
 * a self-hosted backend has no size cap, so failing soft beats failing shut.
 */
export async function prepareForVision(blob: Blob): Promise<Blob> {
  try {
    // Read the orientation from the bytes rather than relying on the decoder.
    // Warehouse phones save the sensor's landscape frame plus a rotation tag
    // (every sample photo we have is orientation 6), and whether a given browser
    // honours that tag on decode is not portable — see jpegOrientation.ts.
    const info = readJpegInfo(await blob.arrayBuffer());
    const bitmap = await createImageBitmap(blob);

    // Correct only when the decoder demonstrably did NOT. `null` means the check
    // was inconclusive, and leaving the pixels alone beats a coin-flip rotation.
    const alreadyRotated = decoderAlreadyRotated(info, bitmap.width, bitmap.height);
    const effective = alreadyRotated === false ? info.orientation : 1;

    const upright = orientationTransform(effective, bitmap.width, bitmap.height);

    let edge = MAX_EDGE;
    let quality = 0.82;
    let best: Blob | null = null;

    for (let attempt = 0; attempt < 8; attempt++) {
      const { width, height } = fitWithin(upright.width, upright.height, edge);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) break;

      // Scale on top of the orientation transform so one drawImage does both.
      const sx = width / upright.width;
      const sy = height / upright.height;
      const [a, b, c, d, e, f] = upright.transform;
      ctx.setTransform(a * sx, b * sy, c * sx, d * sy, e * sx, f * sy);
      ctx.drawImage(bitmap, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      const out = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', quality)
      );
      if (!out) break;
      best = out;
      if (out.size <= MAX_UPLOAD_BYTES) break;

      // Shrink before smearing. The layer seams between courses are the signal
      // the model counts, and quality below ~0.5 blurs exactly those edges.
      if (quality > 0.5) {
        quality -= 0.12;
      } else {
        edge = Math.round(edge * 0.8);
        quality = 0.82;
      }
    }

    bitmap.close?.();
    return best ?? blob;
  } catch {
    return blob;
  }
}

/**
 * Send a pallet-face photo to the vision endpoint. Throws on network error /
 * non-2xx (including 501 "not configured" when no backend is set) so the caller
 * can fall back to the manual layer entry.
 */
export async function analyzePalletCount(blob: Blob): Promise<PalletCountResult> {
  const upload = await prepareForVision(blob);

  const res = await fetch(`${apiBase}/api/analyze-pallet-count`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: upload,
  });
  if (!res.ok) {
    throw new Error(`analyze-pallet-count failed: ${res.status}`);
  }
  return (await res.json()) as PalletCountResult;
}
