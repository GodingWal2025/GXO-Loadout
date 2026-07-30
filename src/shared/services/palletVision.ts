// Client wrapper for the server-side pallet bag-count assist. The detector
// (RF-DETR / OWLv2, see detector-service/) runs behind the Function so its
// URL/key never reach the browser. It detects bags on the visible face and
// reports the visible-face count and layer count; the caller multiplies layers
// by the known bags-per-layer for the pallet total and the verifier confirms.

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
 * Straight-from-camera photos are ~2.5MB. The detector accepts the raw JPEG
 * bytes, so there is no hard inline-size cap, but a smaller upload keeps the
 * round trip inside the 45s Static Web Apps gateway timeout and off slow
 * warehouse connections. 128KB is small enough for that while preserving the
 * layer seams the detector keys on.
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

export interface LayerConsensus {
  /** Agreed layer count, or null with no samples. */
  value: number | null;
  /** How many samples backed `value`. */
  votes: number;
  total: number;
  /** True when no single value had a clear plurality — the human should decide. */
  tied: boolean;
}

/**
 * Reduce repeated layer estimates to one number.
 *
 * Measured on real pallets (prior pallet-photo evaluation): a single photo is right
 * about 65% of the time and never off by more than 2, while the consensus across
 * a pallet's four faces was right on 4 of 5. The model is also not deterministic
 * even at temperature 0, so re-estimating the same face is informative too.
 *
 * Uses the most frequent value rather than the mean or median, so the result is
 * always a count something actually observed — a median of [8,8,10,10] would be
 * 9, which no face reported. A tie is reported rather than silently broken,
 * because that is precisely the case where the estimate should not be trusted.
 */
export function consensusLayers(samples: readonly number[]): LayerConsensus {
  const valid = samples.filter((n) => Number.isInteger(n) && n > 0);
  if (valid.length === 0) return { value: null, votes: 0, total: 0, tied: false };

  const counts = new Map<number, number>();
  for (const n of valid) counts.set(n, (counts.get(n) ?? 0) + 1);

  let best = valid[0];
  let bestCount = 0;
  for (const [n, c] of counts) {
    // Prefer the higher count; on equal counts prefer the larger layer value so
    // the choice is deterministic rather than dependent on Map iteration order.
    if (c > bestCount || (c === bestCount && n > best)) {
      best = n;
      bestCount = c;
    }
  }

  const tied = [...counts.values()].filter((c) => c === bestCount).length > 1;
  return { value: best, votes: bestCount, total: valid.length, tied };
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
 * How many times one photo is analyzed per estimate.
 *
 * The model is not deterministic even at temperature 0 (vLLM continuous
 * batching): the same pallet photo returned 10, then 8, then 8 on consecutive
 * requests. Measured effect of reducing three readings to their consensus
 * (prior pallet-photo evaluation): a single reading is right ~55% of the time either
 * way, but across a pallet's faces it took the result from 5 correct / 1 wrong
 * to 6 correct / 0 wrong.
 *
 * Costs ~12s of wall clock measured against production, NOT the ~3s a single call
 * takes — the requests do not batch end to end, they largely serialize through the
 * Function and the NIM. Still inside the 45s Static Web Apps ceiling with ~30s to
 * spare, but raising this number is not free: 5 samples would land near the limit.
 *
 * This does not rescue a photo the model simply reads wrong — three samples of one
 * face have agreed on an incorrect count. Voting across DIFFERENT faces is what
 * corrects that, which is why each press adds a separate face vote.
 */
const SAMPLES_PER_PHOTO = 3;

/**
 * Analyze one photo several times and reduce it to a single reading.
 *
 * Returns the consensus layer count with the rest of the fields from the first
 * successful response. Rejects only if EVERY attempt failed, so one flaky
 * request doesn't cost the inspector a retake.
 */
export async function estimatePalletFace(blob: Blob): Promise<PalletCountResult> {
  const upload = await prepareForVision(blob);

  const settled = await Promise.allSettled(
    Array.from({ length: SAMPLES_PER_PHOTO }, () => postForAnalysis(upload))
  );
  const ok = settled
    .filter((s): s is PromiseFulfilledResult<PalletCountResult> => s.status === 'fulfilled')
    .map((s) => s.value);

  if (ok.length === 0) {
    const first = settled[0];
    throw first && first.status === 'rejected'
      ? first.reason
      : new Error('analyze-pallet-count failed');
  }

  const layers = consensusLayers(
    ok.map((r) => r.layers).filter((n): n is number => typeof n === 'number')
  );
  return { ...ok[0], layers: layers.value ?? ok[0].layers };
}

/** The four required pallet-face slots, in capture order. */
export const PALLET_FACE_SLOTS = ['FRONT_VIEW', 'SIDE_VIEW_1', 'BACK_VIEW', 'SIDE_VIEW_2'] as const;

export interface FaceReading {
  slotKey: string;
  layers: number | null;
  /** Undefined unless that face's request failed. */
  error?: string;
}

export interface PalletFacesEstimate {
  consensus: LayerConsensus;
  readings: FaceReading[];
  /** Anomalies seen on ANY face — a torn bag on one side still matters. */
  topLayerFull: boolean;
  gaps: boolean;
  damage: boolean;
  modelVersion?: string;
}

/**
 * Estimate layers from the pallet's four required face photos.
 *
 * This is the strongest configuration measured (prior pallet-photo evaluation): a
 * single face is right ~55% of the time, but the consensus across four faces was
 * right on 6 of 7 pallets. It also sidesteps the one failure mode voting cannot
 * fix — a close-up of a bag label reads 1-5 layers at high confidence, and these
 * four slots are by definition whole-pallet views, so an off-target photo can no
 * longer reach the estimator.
 *
 * One sample per face, not three: the NIM processes concurrent vision requests
 * semi-serially (3 concurrent measured at ~12s), so 12 requests would leave an
 * inspector waiting close to a minute. Four faces is the bigger accuracy lever.
 * Callers wanting more can run it again — samples accumulate.
 *
 * A face whose request fails is reported and skipped rather than failing the whole
 * estimate; three good faces still vote.
 */
export async function estimateFromFaces(
  faces: readonly { slotKey: string; blob: Blob }[]
): Promise<PalletFacesEstimate> {
  const prepared = await Promise.all(
    faces.map(async (f) => ({ slotKey: f.slotKey, upload: await prepareForVision(f.blob) }))
  );

  const settled = await Promise.allSettled(prepared.map((p) => postForAnalysis(p.upload)));

  const readings: FaceReading[] = [];
  const good: PalletCountResult[] = [];
  settled.forEach((s, i) => {
    const slotKey = prepared[i].slotKey;
    if (s.status === 'fulfilled') {
      readings.push({ slotKey, layers: s.value.layers });
      good.push(s.value);
    } else {
      readings.push({ slotKey, layers: null, error: String(s.reason?.message ?? s.reason) });
    }
  });

  return {
    consensus: consensusLayers(
      readings.map((r) => r.layers).filter((n): n is number => typeof n === 'number')
    ),
    readings,
    // Default to "fine" only when a face actually said so; an all-failed estimate
    // must not read as a clean pallet.
    topLayerFull: good.length > 0 ? good.every((r) => r.topLayerFull !== false) : true,
    gaps: good.some((r) => r.gaps),
    damage: good.some((r) => r.damage),
    modelVersion: good[0]?.modelVersion,
  };
}

// --- multi-face assessment -------------------------------------------------

export interface AssessedFace {
  index: number;
  slotKey: string | null;
  /** The model's own flap tally for this face. */
  bagFlaps: number | null;
  layers: number | null;
  /** Normalised [x1,y1,x2,y2] boxes, 0-1 of the photo. Present when boxes asked for. */
  flapBoxes?: number[][];
  boxCount?: number;
  /** False when the model's tally disagrees with the boxes it actually located. */
  countMatchesBoxes?: boolean;
}

export interface PalletAssessment {
  success: boolean;
  faces: AssessedFace[];
  /** Sum of per-face flap tallies — every bag's flap faces exactly one side. */
  visibleBagTotal: number | null;
  /** Same sum computed from located boxes; the more trustworthy of the two. */
  visibleBagTotalFromBoxes?: number;
  interiorBags?: number | null;
  estimatedPalletTotal?: number | null;
  leaning?: boolean | null;
  overhang?: boolean | null;
  wrapIntact?: boolean | null;
  loadStable?: boolean | null;
  conditionNotes?: string | null;
  gaps: boolean;
  damage: boolean;
  topLayerFull: boolean;
  confidence: number | null;
  rationale: string | null;
  modelVersion?: string;
  imageCount?: number;
  error?: string;
}

export interface AssessOptions {
  /** Ask for a box per flap. Costs tokens and latency; the count gets more trustworthy. */
  wantBoxes?: boolean;
  /** Ask about bags hidden inside the stack — invisible to any detector. */
  wantInterior?: boolean;
  /** Ask about lean, overhang, wrap and stability. */
  wantCondition?: boolean;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  // Chunked: spreading a ~120KB array into String.fromCharCode at once risks
  // blowing the argument limit on some mobile browsers.
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

/**
 * Assess a whole pallet from several face photos in ONE request.
 *
 * Cosmos accepts up to 5 images per call, so the model reconciles the faces
 * itself — they are views of one rigid object — instead of the client voting over
 * independent single-photo guesses. That also lets it answer things no single
 * face supports: the occluded interior count, and whether the load is physically
 * sound (lean, overhang, wrap, stability), which is what a physical-AI model is
 * actually built for.
 *
 * Kept separate from analyzePalletCount on purpose: adding one field to that
 * prompt measurably degraded layer counting, so the proven path stays untouched
 * and each capability here can be switched off to isolate its effect.
 */
export async function assessPalletFaces(
  faces: readonly { slotKey: string; blob: Blob }[],
  opts: AssessOptions = {}
): Promise<PalletAssessment> {
  const images = await Promise.all(
    faces.map(async (f) => ({
      slotKey: f.slotKey,
      dataUrl: await blobToDataUrl(await prepareForVision(f.blob)),
    }))
  );

  const res = await fetch(`${apiBase}/api/analyze-pallet-faces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      images,
      wantBoxes: opts.wantBoxes !== false,
      wantInterior: opts.wantInterior !== false,
      wantCondition: opts.wantCondition !== false,
    }),
  });
  if (!res.ok) {
    throw new Error(`analyze-pallet-faces failed: ${res.status}`);
  }
  return (await res.json()) as PalletAssessment;
}

/**
 * Best available bag total from an assessment, preferring counted boxes over the
 * model's own tally.
 *
 * Enumerating many small repeated objects is where these models are weakest, so a
 * self-reported number is the least reliable figure available; a count of boxes it
 * actually located is better, and auditable. Returns which source was used so the
 * UI can be honest about it.
 */
export function bestBagTotal(
  a: PalletAssessment
): { total: number | null; source: 'boxes' | 'tally' | 'none' } {
  if (typeof a.visibleBagTotalFromBoxes === 'number' && a.visibleBagTotalFromBoxes > 0) {
    return { total: a.visibleBagTotalFromBoxes, source: 'boxes' };
  }
  if (typeof a.visibleBagTotal === 'number' && a.visibleBagTotal > 0) {
    return { total: a.visibleBagTotal, source: 'tally' };
  }
  return { total: null, source: 'none' };
}

/** Physical problems worth surfacing, as short labels. Empty when the load looks sound. */
export function physicalIssues(a: PalletAssessment): string[] {
  const out: string[] = [];
  if (a.leaning === true) out.push('leaning');
  if (a.overhang === true) out.push('overhanging the pallet');
  if (a.wrapIntact === false) out.push('wrap damaged');
  if (a.loadStable === false) out.push('load may shift');
  if (a.damage) out.push('bag damage');
  if (a.gaps) out.push('gaps/missing bags');
  if (a.topLayerFull === false) out.push('top course short');
  return out;
}

/**
 * Send a pallet-face photo to the vision endpoint. Throws on network error /
 * non-2xx (including 501 "not configured" when no backend is set) so the caller
 * can fall back to the manual layer entry.
 */
export async function analyzePalletCount(blob: Blob): Promise<PalletCountResult> {
  return postForAnalysis(await prepareForVision(blob));
}

async function postForAnalysis(upload: Blob): Promise<PalletCountResult> {
  const customDetectorUrl = (
    (typeof localStorage !== 'undefined' ? localStorage.getItem('loadout_detector_url') : null) ||
    import.meta.env.VITE_DETECTOR_SERVICE_URL ||
    ''
  ).trim().replace(/\/+$/, '');

  const endpoint = customDetectorUrl
    ? (customDetectorUrl.endsWith('/analyze') ? customDetectorUrl : `${customDetectorUrl}/analyze`)
    : `${apiBase}/api/analyze-pallet-count`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: upload,
  });
  if (!res.ok) {
    throw new Error(`analyze-pallet-count failed: ${res.status}`);
  }
  return (await res.json()) as PalletCountResult;
}
